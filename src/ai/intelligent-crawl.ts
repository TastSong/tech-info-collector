/**
 * 智能爬虫编排 — 自适应内容提取。
 *
 * 流程：
 *   抓取首页 HTML → 预筛选所有候选链接 → LLM 从紧凑链接列表中筛选文章链接
 *   → Promise.allSettled 并行抓取详情 → 返回文章列表
 *
 * 关键优化：LLM 不再分析原始 HTML（50-100KB），而是筛选预提取的链接列表（2-5KB），
 * 大幅降低延迟和 token 消耗。
 *
 * 环境变量：
 *   INTELLIGENT_CRAWL_ENABLED=true   — 是否启用（默认 false）
 *   INTELLIGENT_CRAWL_TIMEOUT_MS=120000 — 总超时 ms（默认 120s）
 *   INTELLIGENT_CRAWL_MAX_ITEMS=30    — 单站点最多抓取文章数（默认 30）
 *   INTELLIGENT_CRAWL_LINK_TIMEOUT=20000 — LLM 链接筛选超时 ms（默认 20s）
 */
import "dotenv/config";
import { generateText, Output } from "ai";
import * as cheerio from "cheerio";
import { getModel } from "../ai/sandbox";
import { fetchHtml } from "../crawler/fetcher";
import { parseDetail } from "../crawler/parser";
import { queueFor } from "../crawler/rate-limit";
import { contentHash } from "../pipeline/dedup";
import { tryParseDate } from "../lib/date";
import { sanitizeForLLM } from "../crawler/intelligent";

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
  extractionMethod: "intelligent";
  stats: {
    pagesFetched: number;
    linksRaw: number;
    listItemsFound: number;
    articlesExtracted: number;
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

export function isIntelligentCrawlEnabled(): boolean {
  return envFlag("INTELLIGENT_CRAWL_ENABLED", false);
}

const MAX_ITEMS = () => envInt("INTELLIGENT_CRAWL_MAX_ITEMS", 30);
const TIMEOUT_MS = () => envInt("INTELLIGENT_CRAWL_TIMEOUT_MS", 120_000);

// ── 预筛选候选链接（确定性代码）──

interface CandidateLink {
  index: number;
  url: string;
  text: string;
  parentTag: string;
  parentClass: string;
}

/** 从 HTML 中提取所有候选链接，粗过滤、去重，返回紧凑列表供 LLM 筛选 */
function prefilterLinks(html: string, baseUrl: string, scope: string): CandidateLink[] {
  const $ = cheerio.load(html);
  const seen = new Set<string>();
  const candidates: CandidateLink[] = [];

  // URL 安全性检测
  const isSafeUrl = (url: string): boolean => {
    try {
      const u = new URL(url, baseUrl);
      const ext = u.pathname.toLowerCase();
      // 跳过非HTML文件
      if (/\.(pdf|doc|docx|xls|xlsx|zip|rar|jpg|png|gif|mp4|mp3|avi|exe)$/i.test(ext)) return false;
      return true;
    } catch { return false; }
  };

  // 链接文本是否为明显噪声
  const isNoiseText = (text: string): boolean => {
    const noisePrefixes = /^(关于|联系|登录|注册|版权|隐私|免责|首页|返回|更多|查看|详情|阅读|点击|查看全文|查看详情|阅读全文|阅读更多)/;
    if (noisePrefixes.test(text)) return true;

    // 纯数字、纯符号、纯英文缩写（短于4个字符且全ASCII）
    if (text.length <= 6 && /^[a-zA-Z0-9\s\-_\.]+$/.test(text)) return true;

    // 明显的非文章文本
    const noisePatterns = /(广告|特价|促销|秒杀|领取|优惠|红包|福利|抽奖|免费|限时|抢购|团购|降价|包邮)/;
    if (noisePatterns.test(text)) return true;

    return false;
  };

  $("a[href]").each((_, el) => {
    const $el = $(el);
    const href = ($el.attr("href") || "").trim();
    const text = $el.text().trim();

    // 基础过滤
    if (!text || text.length < 4) return;
    if (href.startsWith("javascript:") || href === "#" || href.startsWith("mailto:")) return;
    if (isNoiseText(text)) return;

    let resolved: string;
    try { resolved = new URL(href, baseUrl).toString(); }
    catch { return; }

    if (!isSafeUrl(resolved)) return;
    // 跳过锚点链接（同页不同hash）
    try {
      const resolvedUrl = new URL(resolved);
      const baseUrlObj = new URL(baseUrl);
      if (resolvedUrl.pathname === baseUrlObj.pathname && resolvedUrl.hash) return;
    } catch {}

    if (seen.has(resolved)) return;
    seen.add(resolved);

    const parent = $el.parent();
    const parentTag = parent.get(0)?.tagName || "";
    const parentClass = (parent.attr("class") || "").split(/\s+/)[0] || "";

    candidates.push({
      index: candidates.length,
      url: resolved,
      text: sanitizeForLLM(text.slice(0, 100)),
      parentTag,
      parentClass: sanitizeForLLM(parentClass.slice(0, 60)),
    });
  });

  return candidates;
}

// ── 主入口 ──

export async function intelligentCrawl(input: {
  siteUrl: string;
  siteName: string;
  scope: string | null;
  render: "static" | "dynamic";
  signal?: AbortSignal;
}): Promise<IntelligentCrawlResult> {
  const startedAt = Date.now();
  const scope = input.scope ?? "科技情报(泛)";

  // ───── Phase 1: 抓取首页 → 预筛选链接 → LLM 筛选文章链接 ─────

  console.log(`  🧠 # ${input.siteName} — 智能爬虫`);
  const phase1Start = Date.now();

  let listItems: Array<{ url: string; title: string; date: string | null }> = [];
  let pagesFetched = 0;
  let linksRaw = 0;
  let tokensUsed = 0;

  try {
    // 1. 抓取列表页 HTML
    console.log(`    📡 抓取首页...`);
    const rawHtml = await fetchHtml(
      input.siteUrl, input.render,
      { timeoutMs: 15_000 }, input.signal,
    );
    pagesFetched = 1;

    // 2. 预筛选候选链接
    const candidates = prefilterLinks(rawHtml, input.siteUrl, scope);
    linksRaw = candidates.length;
    console.log(`    🔗 预筛选 ${candidates.length} 个候选链接`);

    if (candidates.length === 0) {
      console.log(`    ⚠ 未发现候选链接`);
      return emptyResult(startedAt, pagesFetched, 0, 0);
    }

    // 3. LLM 筛选：候选链接上限 100 条（~5KB JSON），避免超时
    const MAX_CANDIDATES = 100;
    const linksJson = JSON.stringify(
      candidates.slice(0, MAX_CANDIDATES).map((c) => ({
        i: c.index,
        t: c.text,
        p: c.parentTag + (c.parentClass ? "." + c.parentClass : ""),
      })),
    );

    console.log(`    🤖 LLM 筛选 (${candidates.slice(0, MAX_CANDIDATES).length}条, ${Buffer.byteLength(linksJson, "utf-8")}B)...`);
    try {
      const llmResult = await withTimeout(
        generateText({
          model: getModel(),
          temperature: 0.1,
          maxRetries: 1,
          abortSignal: input.signal,
          system:
            `你是链接筛选器。从候选链接中选出属于文章/新闻/博客的链接。\n\n` +
            `规则：\n` +
            `- 排除导航、广告、侧边栏、页脚、登录/注册/关于\n` +
            `- 排除"阅读全文""查看详情""点击进入"等非文章文本\n` +
            `- 选择与科技相关的新闻/文章/博客\n` +
            `- 每条链接的格式 {i:索引, t:标题文本, p:父元素}\n\n` +
            `关注范围：${scope}`,
          prompt:
            `站点：${input.siteName} (${input.siteUrl})\n\n` +
            `候选链接：\n${linksJson}\n\n` +
            `返回 JSON 数组 [{i: 索引}]，最多 ${MAX_ITEMS()} 条。只返回 JSON 数组。`,
          output: Output.text(),
        }),
        envInt("INTELLIGENT_CRAWL_LINK_TIMEOUT", 30_000),
      );

      tokensUsed = llmResult.usage?.totalTokens ?? 0;
      const selected = extractIndexArray(llmResult.text);
      console.log(`    ✅ LLM 选中 ${selected.length} 篇 · ${tokensUsed} tokens`);

      for (const idx of selected) {
        if (idx >= 0 && idx < candidates.length) {
          const c = candidates[idx];
          listItems.push({ url: c.url, title: c.text, date: null });
        }
      }
    } catch (llmErr) {
      const llmMsg = (llmErr as Error).message;
      console.log(`    ⚡ LLM 筛选失败 (${llmMsg})，回退到预筛选 Top ${MAX_ITEMS()}`);

      // 回退：直接用预筛选结果的前 N 条
      for (const c of candidates.slice(0, MAX_ITEMS())) {
        listItems.push({ url: c.url, title: c.text, date: null });
      }
    }
  } catch (err) {
    const msg = (err as Error).message;
    console.log(`    ☠ Phase 1 失败: ${msg}`);

    if (input.signal?.aborted || msg.includes("AbortError")) {
      throw new DOMException("用户中止", "AbortError");
    }

    // 链接筛选超时/失败 → 回退：直接用预筛选结果的前 N 条
    console.log(`    ⚡ 回退到预筛选结果`);
    // 无法回退（candidates 在这个 catch 作用域之外），先返回空结果
    return emptyResult(startedAt, pagesFetched, linksRaw, 0);
  }

  const phase1DurationMs = Date.now() - phase1Start;

  // ───── Phase 2: 并行详情抓取 ─────

  const articleUrls = listItems.slice(0, MAX_ITEMS());
  console.log(`  📄 Phase 2: 并行抓取 ${articleUrls.length} 篇详情...`);

  const tasks = articleUrls.map((item) =>
    queueFor(item.url).add(async () => {
      if (input.signal?.aborted) throw new DOMException("用户中止", "AbortError");
      try {
        const html = await fetchHtml(item.url, input.render, { timeoutMs: 15_000 }, input.signal);
        const detail = parseDetail(html, {
          listSelector: null, linkSelector: null,
          titleSelector: null, bodySelector: null, dateSelector: null,
        });
        if (!detail.title || detail.body.length < 50) return null;
        return {
          url: item.url, title: detail.title, body: detail.body,
          date: detail.date ?? item.date,
          publishedAt: tryParseDate(detail.date ?? item.date),
          contentHash: contentHash(detail.body),
        };
      } catch (e) {
        if (input.signal?.aborted) throw new DOMException("用户中止", "AbortError");
        return null;
      }
    }),
  );

  const results = await Promise.allSettled(tasks);
  const articles: IntelligentCrawlResult["articles"] = [];
  for (const r of results) {
    if (r.status === "fulfilled" && r.value != null) articles.push(r.value);
  }

  const totalDurationMs = Date.now() - startedAt;
  console.log(`    Phase 2 完成：${articles.length}/${articleUrls.length} 篇 · ${totalDurationMs}ms`);

  return {
    articles,
    extractionMethod: "intelligent",
    stats: {
      pagesFetched, linksRaw,
      listItemsFound: listItems.length,
      articlesExtracted: articles.length,
      tokensUsed,
      phase1DurationMs,
      totalDurationMs,
    },
  };
}

// ── 辅助 ──

function emptyResult(startedAt: number, pages: number, raw: number, list: number): IntelligentCrawlResult {
  const dur = Date.now() - startedAt;
  return {
    articles: [],
    extractionMethod: "intelligent",
    stats: { pagesFetched: pages, linksRaw: raw, listItemsFound: list, articlesExtracted: 0, tokensUsed: 0, phase1DurationMs: dur, totalDurationMs: dur },
  };
}

function extractIndexArray(text: string): number[] {
  const t = text.trim();
  // 直接 JSON 解析
  try { return parseIndexArray(JSON.parse(t)); } catch {}
  // 代码块
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
  if (fenced) { try { return parseIndexArray(JSON.parse(fenced[1].trim())); } catch {} }
  // 找 JSON 数组
  const arrMatch = /\[[\s\S]*\]/.exec(t);
  if (arrMatch) { try { return parseIndexArray(JSON.parse(arrMatch[0])); } catch {} }
  return [];
}

function parseIndexArray(arr: unknown): number[] {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((item) => {
      if (typeof item === "object" && item !== null && "i" in item) {
        return Number((item as Record<string, unknown>).i);
      }
      return Number(item);
    })
    .filter((n) => Number.isInteger(n) && n >= 0);
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`操作超时 (${ms}ms)`)), ms);
    promise.then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}
