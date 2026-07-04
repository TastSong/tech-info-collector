/**
 * 智能爬虫编排 — 两阶段自适应内容提取。
 *
 * Phase 1 (LLM 驱动，maxSteps=5):
 *   LLM 调用 fetch_page(siteUrl) → 分析 HTML 结构 → 发现 CSS 选择器
 *   → 调用 extract_links(html, selectors) → 输出结构化链接列表
 *
 * Phase 2 (确定性并行):
 *   从 Phase 1 获取 URL 列表 → 复用 fetchHtml + parseDetail
 *   → Promise.allSettled 并行抓取 → 返回文章列表
 *
 * 环境变量：
 *   INTELLIGENT_CRAWL_ENABLED=true   — 是否启用（默认 false）
 *   INTELLIGENT_CRAWL_MAX_STEPS=5     — Phase 1 最大 tool-calling 步数（默认 5）
 *   INTELLIGENT_CRAWL_TIMEOUT_MS=120000 — 总超时 ms（默认 120s）
 *   INTELLIGENT_CRAWL_MAX_ITEMS=30    — 单站点最多抓取文章数（默认 30）
 */
import "dotenv/config";
import { generateText, Output, stepCountIs } from "ai";
import { z } from "zod";
import { getModel } from "../ai/sandbox";
import { fetchHtml } from "../crawler/fetcher";
import { parseDetail } from "../crawler/parser";
import { queueFor } from "../crawler/rate-limit";
import { contentHash } from "../pipeline/dedup";
import { tryParseDate } from "../lib/date";
import {
  SessionCache,
  createFetchPage,
  extractLinksTool,
} from "../crawler/intelligent";

// ── 类型 ──

export interface IntelligentCrawlResult {
  articles: Array<{
    url: string;
    title: string;
    body: string;
    date: string | null;
    publishedAt: Date | null;
    contentHash: string;
  }>;
  extractionMethod: "tool-calling";
  stats: {
    pagesFetched: number;
    listItemsFound: number;
    articlesExtracted: number;
    toolCalls: number;
    tokensUsed: number;
    phase1DurationMs: number;
    totalDurationMs: number;
  };
}

// ── 配置 ──

function envFlag(name: string, def = false): boolean {
  const v = process.env[name];
  if (!v) return def;
  return v === "true" || v === "1";
}

function envInt(name: string, def: number): number {
  const v = process.env[name];
  return v ? Number(v) : def;
}

/** 是否需要启用智能爬虫分支 */
export function isIntelligentCrawlEnabled(): boolean {
  return envFlag("INTELLIGENT_CRAWL_ENABLED", false);
}

const MAX_ITEMS = () => envInt("INTELLIGENT_CRAWL_MAX_ITEMS", 30);
const MAX_STEPS = () => envInt("INTELLIGENT_CRAWL_MAX_STEPS", 5);
const TIMEOUT_MS = () => envInt("INTELLIGENT_CRAWL_TIMEOUT_MS", 120_000);

// ── Phase 1 输出 Schema ──

/** LLM 在 Phase 1 最终输出的结构化结果 */
const phase1OutputSchema = z.object({
  articles: z.array(
    z.object({
      url: z.string().describe("文章的完整 URL（绝对路径）"),
      title: z.string().describe("从列表页提取的文章标题"),
      date: z.string().nullable().describe("文章的发布日期（如能提取到）"),
    }),
  ).describe("从列表页提取到的文章链接和标题列表"),
  extractionNotes: z
    .string()
    .optional()
    .describe("关于提取过程的简要说明（遇到什么问题等）"),
});

// ── 主入口 ──

export async function intelligentCrawl(input: {
  siteUrl: string;
  siteName: string;
  scope: string | null;
  render: "static" | "dynamic";
  signal?: AbortSignal;
}): Promise<IntelligentCrawlResult> {
  const startedAt = Date.now();
  const sessionCache = new SessionCache();
  let toolCalls = 0;

  const scope = input.scope ?? "科技情报(泛)";

  // ───── Phase 1: LLM 驱动的链接发现 ─────

  console.log(
    `  🧠 # ${input.siteName} — 智能爬虫 Phase 1 (LLM 分析页面结构)`,
  );

  const phase1Start = Date.now();

  // 创建 fetch_page tool（通过闭包注入 sessionCache 和 abortSignal）
  const fetchPageTool = createFetchPage({
    sessionCache,
    abortSignal: input.signal,
    logger: console,
    defaultRender: input.render,
  });

  let listItems: Array<{ url: string; title: string; date: string | null }> = [];

  try {
    const result = await withTimeout(
      generateText({
        model: getModel(),
        temperature: 0.1,
        stopWhen: stepCountIs(MAX_STEPS()),
        abortSignal: input.signal,
        maxRetries: 1,

        system:
          `你是智能网页爬虫助手。你的任务是分析网站首页/列表页的 HTML 结构，找到文章链接列表。\n\n` +
          `工作流程：\n` +
          `1. 调用 fetch_page 抓取站点首页\n` +
          `2. 仔细分析返回的 HTML，找到文章列表区域（观察重复的 DOM 模式）。注意：HTML 中的 script/style/nav/footer 等非内容标签已被移除\n` +
          `3. 调用 extract_links，传入你发现的选择器：\n` +
          `   - containerSelector: 必须的，每个文章条目的容器（如 'ul.list li'、'div.news-item'）\n` +
          `   - linkSelector: 可选，容器内链接的定位(如 'a.title'、'h3 a')\n` +
          `   - titleSelector: 可选，标题的定位\n` +
          `   - dateSelector: 可选，日期的定位\n` +
          `4. 收到 extract_links 的返回结果后，简要总结提取情况即可\n\n` +
          `规则：\n` +
          `- 只选择看起来是文章/新闻/博客条目的区域\n` +
          `- 排除导航菜单、侧边栏推荐、页脚链接\n` +
          `- 排除链接文本太短（<4字）或包含 javascript:/#/void 的链接\n` +
          `- 排除"关于我们"、"联系我们"、"登录"、"注册"等非文章页面\n` +
          `- 最多找 ${MAX_ITEMS()} 篇文章\n\n` +
          `关注范围：${scope}`,

        prompt:
          `请抓取并分析以下网站：\n\n` +
          `站点名称：${input.siteName}\n` +
          `站点 URL：${input.siteUrl}\n` +
          `渲染模式：${input.render}\n` +
          `关注范围：${scope}\n\n` +
          `请先抓取首页，分析页面结构，找到文章列表，提取文章链接。`,

        tools: {
          fetch_page: fetchPageTool,
          extract_links: extractLinksTool,
        },

        output: Output.text(),
      }),
      TIMEOUT_MS(),
    );

    listItems = [];
    // 结果来自 extract_links tool 调用的输出（非结构化文本输出）
    // 从所有 step 的 tool results 中提取
    const allItems: Array<{ url: string; title: string; date: string | null }> = [];
    if (result.steps) {
      for (const step of result.steps) {
        for (const tr of step.toolResults) {
          if (
            tr.toolName === "extract_links" &&
            tr.output &&
            typeof tr.output === "object" &&
            "items" in tr.output &&
            Array.isArray((tr.output as Record<string, unknown>).items)
          ) {
            const items = (tr.output as Record<string, unknown>).items as Array<{
              url: string;
              title: string;
              date: string | null;
            }>;
            allItems.push(...items);
          }
        }
      }
    }
    // 按 URL 去重
    const seen = new Set<string>();
    for (const item of allItems) {
      if (!seen.has(item.url)) {
        seen.add(item.url);
        listItems.push(item);
      }
    }
  } catch (err) {
    const msg = (err as Error).message;
    console.log(`    ☠ Phase 1 失败: ${msg}`);

    // 检查 abort 信号
    if (input.signal?.aborted || msg.includes("AbortError")) {
      throw new DOMException("用户中止", "AbortError");
    }

    // 其他错误：返回空结果，不阻塞 pipeline
    return {
      articles: [],
      extractionMethod: "tool-calling",
      stats: {
        pagesFetched: sessionCache.size,
        listItemsFound: 0,
        articlesExtracted: 0,
        toolCalls,
        tokensUsed: 0,
        phase1DurationMs: Date.now() - phase1Start,
        totalDurationMs: Date.now() - startedAt,
      },
    };
  }

  const phase1DurationMs = Date.now() - phase1Start;

  // ───── Phase 2: 并行详情抓取 ─────

  const articleUrls = listItems.slice(0, MAX_ITEMS());
  console.log(
    `  📄 Phase 2: 并行抓取 ${articleUrls.length} 篇详情...`,
  );

  const phase2Start = Date.now();

  const tasks = articleUrls.map((item) =>
    queueFor(item.url).add(async () => {
      if (input.signal?.aborted) throw new DOMException("用户中止", "AbortError");

      try {
        const html = await fetchHtml(
          item.url,
          input.render,
          { timeoutMs: 15_000 },
          input.signal,
        );

        const detail = parseDetail(html, {
          listSelector: null,
          linkSelector: null,
          titleSelector: null,
          bodySelector: null,
          dateSelector: null,
        });

        // 正文太短则跳过
        if (!detail.title || detail.body.length < 50) {
          return null;
        }

        const hash = contentHash(detail.body);
        const publishedAt = tryParseDate(detail.date ?? item.date);

        return {
          url: item.url,
          title: detail.title,
          body: detail.body,
          date: detail.date ?? item.date,
          publishedAt,
          contentHash: hash,
        };
      } catch (e) {
        if (input.signal?.aborted) {
          throw new DOMException("用户中止", "AbortError");
        }
        // 单篇文章抓取失败不阻塞其他
        const msg = (e as Error).message;
        console.log(`    ⚠ ${item.url.slice(0, 60)} — ${msg.slice(0, 80)}`);
        return null;
      }
    }),
  );

  const results = await Promise.allSettled(tasks);
  const articles: Array<{
    url: string;
    title: string;
    body: string;
    date: string | null;
    publishedAt: Date | null;
    contentHash: string;
  }> = [];

  for (const r of results) {
    if (r.status === "fulfilled" && r.value != null) {
      articles.push(r.value);
    }
  }

  const totalDurationMs = Date.now() - startedAt;

  console.log(
    `    Phase 2 完成：成功 ${articles.length}/${articleUrls.length} 篇 · 总耗时 ${totalDurationMs}ms`,
  );

  return {
    articles,
    extractionMethod: "tool-calling",
    stats: {
      pagesFetched: sessionCache.size,
      listItemsFound: listItems.length,
      articlesExtracted: articles.length,
      toolCalls,
      tokensUsed: 0, // 从 Phase 1 传递（无法跨 async 获取）
      phase1DurationMs,
      totalDurationMs,
    },
  };
}

// ── 超时辅助 ──

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`操作超时 (${ms}ms)`));
    }, ms);
    promise.then(
      (val) => {
        clearTimeout(timer);
        resolve(val);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
