/**
 * 智能爬虫工具 — LLM tool-calling 的自适应内容提取基础组件。
 *
 * 与 S18 原方案的核心区别：
 *  - extract_links 工具接收 LLM 分析出的 CSS 选择器，执行确定性提取
 *  - LLM 的角色是"分析 DOM → 发现选择器"，而非"直接提取内容"
 *  - LLM 做它擅长的（模式识别），确定性代码做它擅长的（精确提取）
 *
 * 注意：AI SDK v7 的 tool.execute 只接收 args 一个参数。
 * 外部依赖（cache、abortSignal、logger）通过闭包注入，而非 toolbox。
 *
 * 提供：
 *  - SessionCache     — 单次 intelligentCrawl 调用内的 LRU 缓存
 *  - createFetchPage  — 创建 fetch_page tool（通过闭包注入依赖）
 *  - extractLinksTool  — 按 LLM 指定的选择器提取文章链接列表
 *  - sanitizeForLLM   — 过滤可见文本中的 prompt injection 模式
 *  - cleanPageHtml    — HTML 清洗
 */
import { tool } from "ai";
import { z } from "zod";
import * as cheerio from "cheerio";
import { fetchHtml } from "./fetcher";
import { parseList } from "./parser";
import type { Selectors } from "./parser";

// ── 常量 ──

/** 清洗后 HTML 最大字节数（防止 token 爆炸） */
const MAX_HTML_BYTES = 500_000;

/** 会话缓存最大条目数 */
const MAX_CACHE_SIZE = 50;

/** fetch page 默认超时 (ms) */
const FETCH_PAGE_TIMEOUT = 15_000;

// ── SessionCache ──

export interface CachedPage {
  url: string;
  title: string;
  actualRender: "static" | "dynamic" | "lightpanda";
  statusCode: number;
  truncated: boolean;
  byteLength: number;
  textPreview: string;
  body: string;
}

export class SessionCache {
  private cache = new Map<string, CachedPage>();
  private keys: string[] = []; // 插入顺序，用于 LRU 淘汰
  private maxSize = MAX_CACHE_SIZE;

  get(url: string): CachedPage | undefined {
    return this.cache.get(url);
  }

  set(url: string, value: CachedPage): void {
    // LRU 淘汰
    if (this.cache.size >= this.maxSize) {
      const oldest = this.keys.shift();
      if (oldest) this.cache.delete(oldest);
    }
    // 如果 key 已存在，更新位置到最新
    const idx = this.keys.indexOf(url);
    if (idx !== -1) this.keys.splice(idx, 1);
    this.keys.push(url);
    this.cache.set(url, value);
  }

  clear(): void {
    this.cache.clear();
    this.keys = [];
  }

  get size(): number {
    return this.cache.size;
  }
}

// ── Prompt Injection 防护 ──

const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?(previous|above|prior|preceding)\s+(instructions?|directives?|messages?|text)/gi,
  /(disregard|forget|override)\s+(all\s+)?(previous|above|prior)\s+(instructions?|directives?)/gi,
  /you\s+are\s+(now|no\s+longer)\s+a[n]?\s+/gi,
  /system\s*(prompt|message|instruction|directive)/gi,
  /<\|im_start\|>/gi,
  /<\|im_end\|>/gi,
  /<\|system\|>/gi,
];

/**
 * 过滤可见文本中可能被 LLM 解释为系统指令的注入模式。
 */
export function sanitizeForLLM(text: string): string {
  let result = text;
  for (const pattern of INJECTION_PATTERNS) {
    result = result.replace(pattern, "[FILTERED]");
  }
  return result;
}

// ── HTML 清洗 ──

const REMOVE_TAGS =
  "script, style, noscript, iframe, svg, " +
  "nav, footer, header, aside, " +
  ".sidebar, .comment, .ad, .advertisement, " +
  ".nav, .navbar, .footer, .header, .menu, .breadcrumb, .share, " +
  ".related-posts, .recommend, .social, .copyright, " +
  '[role="navigation"], [role="banner"], [role="contentinfo"], [role="complementary"]';

/**
 * 清洗 HTML：去除不需要的标签、注释、空元素、多余属性。
 * 保留标签结构让 LLM 能分析 DOM 模式。
 */
export function cleanPageHtml(rawHtml: string): string {
  const $ = cheerio.load(rawHtml);

  // 移除不需要的标签
  $(REMOVE_TAGS).remove();

  // 移除注释
  $.root()
    .find("*")
    .contents()
    .each(function () {
      if (this.type === "comment") $(this).remove();
    });

  // 递归移除空标签
  let changed = true;
  while (changed) {
    changed = false;
    $.root()
      .find("*")
      .each(function () {
        const el = $(this);
        if (
          el.children().length === 0 &&
          !el.text().trim() &&
          !el.attr("src") &&
          !el.attr("href") &&
          !el.is("img, br, hr, input, meta, link")
        ) {
          el.remove();
          changed = true;
        }
      });
  }

  // 移除 style/event handler/data- 属性
  $.root()
    .find("*")
    .each(function () {
      const el = $(this);
      const attrs = Object.keys(el.attr() || {});
      for (const attr of attrs) {
        if (attr.startsWith("on") || attr === "style" || attr.startsWith("data-")) {
          el.removeAttr(attr);
        }
      }
    });

  return $.html();
}

// ── 辅助 ──

function extractMetaTitle(rawHtml: string): string {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(rawHtml);
  return m ? m[1].replace(/\s+/g, " ").trim().slice(0, 300) : "";
}

function truncateHtml(
  html: string,
  maxBytes: number,
): { body: string; truncated: boolean } {
  const blen = Buffer.byteLength(html, "utf-8");
  if (blen <= maxBytes) return { body: html, truncated: false };
  let out = "";
  let cur = 0;
  for (const c of html) {
    const cb = Buffer.byteLength(c, "utf-8");
    if (cur + cb > maxBytes) break;
    out += c;
    cur += cb;
  }
  return { body: out, truncated: true };
}

// ── fetch_page Tool（工厂函数 — 通过闭包注入外部依赖） ──

/**
 * 创建 fetch_page tool。
 * 外部依赖（缓存、abortSignal、logger）通过闭包注入，因为 AI SDK v7 的
 * tool.execute 只接收 args，不接收 toolbox 参数。
 */
export function createFetchPage(opts: {
  sessionCache: SessionCache;
  abortSignal?: AbortSignal;
  logger?: typeof console;
  defaultRender?: "static" | "dynamic" | "lightpanda";
}) {
  const { sessionCache, abortSignal, logger } = opts;
  const defaultRender = opts.defaultRender ?? "static";

  return tool({
    description:
      "抓取指定 URL 的网页内容，返回清洗后的 HTML 文本。" +
      "用于获取列表页或文章详情页的内容。" +
      "同一 URL 在一次会话中只会抓取一次（有缓存）。" +
      "返回的 HTML 已去除 script/style/导航/侧边栏，只保留结构化内容。",

    inputSchema: z.object({
      url: z.string().url().describe("要抓取的网页 URL"),
      render: z
        .enum(["static", "dynamic", "lightpanda"])
        .default(defaultRender)
        .describe("static=HTTP请求；lightpanda=Lightpanda浏览器；dynamic=Playwright浏览器"),
    }),

    execute: async ({ url, render }): Promise<CachedPage> => {
      // 检查缓存
      const cached = sessionCache.get(url);
      if (cached) {
        logger?.debug?.(`[fetch_page] cache hit: ${url}`);
        return cached;
      }

      logger?.debug?.(`[fetch_page] fetching: ${url} [${render}]`);
      const rawHtml = await fetchHtml(
        url,
        render,
        { timeoutMs: FETCH_PAGE_TIMEOUT },
        abortSignal,
      );

      const title = sanitizeForLLM(extractMetaTitle(rawHtml));
      const cleaned = cleanPageHtml(rawHtml);
      const { body, truncated } = truncateHtml(cleaned, MAX_HTML_BYTES);

      // 纯文本预览
      const textOnly = cheerio.load(body)("body").text() || body.replace(/<[^>]*>/g, "");
      const textPreview = textOnly.replace(/\s+/g, " ").trim().slice(0, 500);

      const result: CachedPage = {
        url,
        title,
        actualRender: render,
        statusCode: 200,
        truncated,
        byteLength: Buffer.byteLength(body, "utf-8"),
        textPreview,
        body,
      };

      sessionCache.set(url, result);
      logger?.debug?.(
        `[fetch_page] done: ${url} (${result.byteLength}B${truncated ? ", TRUNCATED" : ""})`,
      );
      return result;
    },
  });
}

// ── extract_links Tool（静态 tool，无外部依赖） ──

export const extractLinksTool = tool({
  description:
    "使用 CSS 选择器从 HTML 中提取文章链接列表。" +
    "你需要先分析 fetch_page 返回的 HTML，找到文章列表的 DOM 模式，" +
    "然后用你发现的 CSS 选择器调用本工具。" +
    "containerSelector 是必须的（每个列表项的容器元素）。",

  inputSchema: z.object({
    html: z.string().describe("清洗后的 HTML 内容（来自 fetch_page 的 body 字段）"),
    baseUrl: z.string().describe("页面原始 URL，用于将相对链接转为绝对URL"),
    containerSelector: z
      .string()
      .describe(
        "文章条目的重复容器选择器，如 'div.news-item'、'ul.news-list > li'、" +
        "'.article-card'。观察 HTML 中找到重复出现的模式。",
      ),
    linkSelector: z
      .string()
      .optional()
      .describe("容器内链接的选择器，不填则取第一个 <a>"),
    titleSelector: z
      .string()
      .optional()
      .describe("容器内标题的选择器，不填则取链接文本"),
    dateSelector: z
      .string()
      .optional()
      .describe("容器内日期的选择器，不填则不提取日期"),
  }),

  execute: async ({ html, baseUrl, containerSelector, linkSelector, titleSelector, dateSelector }) => {
    const selectors: Selectors = {
      listSelector: containerSelector,
      linkSelector: linkSelector ?? null,
      titleSelector: titleSelector ?? null,
      bodySelector: null,
      dateSelector: dateSelector ?? null,
    };

    const items = parseList(html, baseUrl, selectors);

    return {
      items: items.slice(0, 50).map((i) => ({
        url: i.url,
        title: i.title,
        date: i.date,
      })),
      totalFound: items.length,
      capped: items.length > 50,
    };
  },
});
