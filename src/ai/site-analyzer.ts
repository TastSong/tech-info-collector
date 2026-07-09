/**
 * 站点分析器 — AI 驱动的站点结构发现。
 *
 * 用于新建/导入站点时的一键识别：
 *   1. 自动检测渲染模式（静态优先，失败时回退到动态）
 *   2. LLM 分析页面结构，发现 CSS 选择器
 *   3. 自动推断分类/子分类/关注范围
 *   4. 三层验证策略确保选择器质量
 *
 * 复用现有模块：
 *   - fetchHtml (crawler/fetcher)  — 静态/动态 HTML 抓取
 *   - parseList (crawler/parser)   — 选择器验证
 *   - getModel (ai/sandbox)        — LLM 单例
 *   - cleanPageHtml / sanitizeForLLM (crawler/intelligent) — HTML 预处理
 */
import "dotenv/config";
import { generateText, Output } from "ai";
import * as cheerio from "cheerio";
import { getModel } from "./sandbox";
import { fetchHtml, type RenderMode } from "../crawler/fetcher";
import { parseList } from "../crawler/parser";
import { cleanPageHtml, sanitizeForLLM } from "../crawler/intelligent";

// ── 常量 ──

/** LLM 分析超时 (ms) */
const AI_TIMEOUT_MS = 60_000;

/** HTML 截断阈值（~12-15K tokens for Chinese HTML） */
const MAX_HTML_BYTES = 50_000;

/** 有意义的页面至少需要的文本长度 */
const MEANINGFUL_MIN_TEXT = 200;

/** 有意义的页面至少需要的链接数 */
const MEANINGFUL_MIN_LINKS = 3;

/** 最多尝试的 URL 数 */
const MAX_URLS_TO_TRY = 3;

// ── 类型 ──

export interface AnalyzeResult {
  category: string;
  subcategory: string;
  render: RenderMode;
  listSelector: string;
  itemSelector: string;
  linkSelector: string;
  titleSelector: string;
  bodySelector: string;
  dateSelector: string;
  aiInvolvement: "extract_judge";
  scope: string;
  sampleLinks: string[];
  diagnostics: {
    urlsTested: number;
    staticWorked: boolean;
    dynamicWorked: boolean;
    bestUrl: string;
    tokensUsed: number;
    selectorConfidence: "high" | "medium" | "low";
  };
}

interface HtmlResult {
  html: string;
  url: string;
  mode: RenderMode;
}

// ── 渲染模式检测 ──

/**
 * 判断 HTML 是否"有意义"（不是 JS 空壳）。
 * 静态抓取 SPA 页面时，通常只返回少量文本和极少链接。
 */
function isMeaningfulHtml(html: string): boolean {
  const $ = cheerio.load(html);
  const textLen = $("body").text().trim().length;
  const linkCount = $("a[href]").length;

  if (textLen < MEANINGFUL_MIN_TEXT) return false;
  if (linkCount < MEANINGFUL_MIN_LINKS) return false;

  // 检测明显的 JS 空壳特征
  const bodyText = $("body").text().toLowerCase();
  const jsShellPatterns = [
    "enable javascript",
    "please enable js",
    "请启用javascript",
    "请开启javascript",
  ];
  for (const p of jsShellPatterns) {
    if (bodyText.includes(p)) return false;
  }

  return true;
}

/** 合并模式 → 人类可读标签 */
function modeLabel(m: RenderMode): string {
  return m === "static" ? "静态" : "动态";
}

/**
 * 对多个 URL 逐一尝试静态/动态抓取，选择最优渲染模式。
 * 策略：每个 URL 先试静态，失败或无意义则试动态；优先选静态。
 */
async function detectRenderMode(
  urls: string[],
  signal?: AbortSignal,
): Promise<{
  bestHtml: string;
  bestUrl: string;
  render: RenderMode;
  staticWorked: boolean;
  dynamicWorked: boolean;
}> {
  let staticWorked = false;
  let dynamicWorked = false;
  let bestHtml = "";
  let bestUrl = "";
  let bestRender: RenderMode = "static";

  const urlsToTry = urls.slice(0, MAX_URLS_TO_TRY);

  for (const url of urlsToTry) {
    // 1) 尝试静态抓取
    try {
      console.log(`  📡 [static] 尝试: ${url.slice(0, 80)}`);
      const html = await fetchHtml(url, "static", { timeoutMs: 15_000 }, signal);
      if (isMeaningfulHtml(html)) {
        staticWorked = true;
        console.log(`  ✅ 静态抓取成功 (${html.length}B)`);
        // 静态优先：直接返回，不再尝试其他 URL
        return { bestHtml: html, bestUrl: url, render: "static", staticWorked: true, dynamicWorked: false };
      }
      console.log(`  ⚠ 静态 HTML 无意义 (text=${cheerio.load(html)("body").text().trim().length}chars, links=${cheerio.load(html)("a[href]").length})`);
    } catch (e) {
      if (signal?.aborted) throw e;
      console.log(`  ⚠ 静态抓取失败: ${(e as Error).message.slice(0, 80)}`);
    }

    // 2) 尝试动态抓取
    try {
      console.log(`  📡 [dynamic] 尝试: ${url.slice(0, 80)}`);
      const html = await fetchHtml(url, "dynamic", { timeoutMs: 30_000 }, signal);
      if (isMeaningfulHtml(html)) {
        dynamicWorked = true;
        console.log(`  ✅ 动态抓取成功 (${html.length}B)`);
        if (!bestHtml || html.length > bestHtml.length) {
          bestHtml = html;
          bestUrl = url;
          bestRender = "dynamic";
        }
        // 动态也能工作，继续尝试其他 URL 看是否有更好的
      } else {
        console.log(`  ⚠ 动态 HTML 无意义`);
      }
    } catch (e) {
      if (signal?.aborted) throw e;
      console.log(`  ⚠ 动态抓取失败: ${(e as Error).message.slice(0, 80)}`);
    }
  }

  if (!bestHtml) {
    throw new Error("所有 URL 均无法抓取（静态+动态均失败）");
  }

  return { bestHtml, bestUrl, render: bestRender, staticWorked, dynamicWorked };
}

// ── HTML 预处理 ──

/** 字节级截断 HTML（保持 UTF-8 安全） */
function truncateHtml(html: string, maxBytes: number): string {
  const blen = Buffer.byteLength(html, "utf-8");
  if (blen <= maxBytes) return html;
  let out = "";
  let cur = 0;
  for (const c of html) {
    const cb = Buffer.byteLength(c, "utf-8");
    if (cur + cb > maxBytes) break;
    out += c;
    cur += cb;
  }
  return out;
}

/**
 * 判断链接文本是否像文章标题（与 inspect.ts 的 looksLikeArticle 一致）。
 */
function looksLikeArticle(text: string, href: string): boolean {
  const t = text.trim();
  if (t.length < 6 || t.length > 80) return false;
  if (!href || href.startsWith("javascript") || href.startsWith("#")) return false;
  if (/^(更多|首页|下一页|上一页|登录|注册|关于|联系|搜索|more|next|prev|home)/i.test(t))
    return false;
  return true;
}

/**
 * 生成页面结构摘要 — 统计候选选择器模式及其出现次数。
 * 帮助 LLM 推理 DOM 模式，无需解析每一个标签。
 */
function structuralSummary(html: string, baseUrl: string): string {
  const $ = cheerio.load(html);
  const title = ($("title").first().text() || "").trim().slice(0, 120);

  // 1) 统计每个父选择器下像文章的链接数（item 级）
  const itemCounts = new Map<string, { count: number; samples: string[] }>();
  $("a[href]").each((_, a) => {
    const $a = $(a);
    const href = ($a.attr("href") || "").trim();
    const text = $a.text();
    if (!looksLikeArticle(text, href)) return;

    const $p = $a.parent();
    const tag = ($p.get(0) as { tagName?: string })?.tagName?.toLowerCase() || "?";
    const cls = ($p.attr("class") || "").split(/\s+/)[0];
    const key = cls ? `${tag}.${cls}` : tag;

    let entry = itemCounts.get(key);
    if (!entry) {
      entry = { count: 0, samples: [] };
      itemCounts.set(key, entry);
    }
    entry.count++;
    if (entry.samples.length < 3) {
      entry.samples.push(text.trim().replace(/\s+/g, " ").slice(0, 50));
    }
  });

  // 2) 统计 container 级（父元素的父元素包含多个像文章链接的组）
  const containerCounts = new Map<string, number>();
  const containerToChild = new Map<string, string>(); // container → 最常见的子选择器
  const processedParents = new Set<string>(); // 防止同一 item 选择器被多次计入

  for (const [itemKey, entry] of itemCounts) {
    if (entry.count < 3) continue;

    // 找包含此 item 的容器
    $(itemKey.replace(".", ".")).each((_, el) => {
      const $el = $(el);
      const $container = $el.parent();
      if (!$container.length) return;

      const cTag = ($container.get(0) as { tagName?: string })?.tagName?.toLowerCase() || "?";
      const cCls = ($container.attr("class") || "").split(/\s+/)[0];
      const cKey = cCls ? `${cTag}.${cCls}` : cTag;

      const uniqueKey = `${cKey}>${itemKey}`;
      if (processedParents.has(uniqueKey)) return;
      processedParents.add(uniqueKey);

      const prev = containerCounts.get(cKey) ?? 0;
      containerCounts.set(cKey, prev + 1);
      if (!containerToChild.has(cKey)) {
        containerToChild.set(cKey, itemKey);
      }
    });
  }

  // 3) 构建摘要文本
  const lines: string[] = [];
  lines.push(`页面标题: ${title}`);
  lines.push(`页面 URL: ${baseUrl}`);
  lines.push(`总链接数: ${$("a[href]").length}`);
  lines.push(`像文章的链接数: ${[...itemCounts.values()].reduce((s, e) => s + e.count, 0)}`);
  lines.push("");

  const rankedItems = [...itemCounts.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 6);

  lines.push("─ 候选 itemSelector（父标签频率 Top 6）─");
  for (const [key, entry] of rankedItems) {
    lines.push(`  ${key} ×${entry.count}${entry.count >= 4 ? " ← 强烈候选" : ""}`);
    for (const s of entry.samples) {
      lines.push(`    · "${s}"`);
    }
  }

  const rankedContainers = [...containerCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4);

  if (rankedContainers.length > 0) {
    lines.push("");
    lines.push("─ 候选 listSelector（容器频率 Top 4）─");
    for (const [key, count] of rankedContainers) {
      const child = containerToChild.get(key) || "?";
      lines.push(`  ${key} (内含 ${child} ×${count})`);
    }
  }

  return lines.join("\n");
}

// ── LLM 分析 ──

/** 从模型回复中提取首个 JSON 对象（容忍代码块与前后文字） */
function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("LLM 输出未找到 JSON 对象");
  }
  return JSON.parse(raw.slice(start, end + 1));
}

interface LlmAnalysisOutput {
  analysis: string;
  listSelector: string;
  itemSelector: string;
  linkSelector: string;
  titleSelector: string;
  bodySelector: string;
  dateSelector: string;
  category: string;
  subcategory: string;
  scope: string;
}

/**
 * 将结构摘要 + 清理后的 HTML 发送给 LLM，获取选择器和元数据。
 */
async function llmAnalyze(
  html: string,
  siteName: string,
  bestUrl: string,
  signal?: AbortSignal,
): Promise<{ result: LlmAnalysisOutput; tokensUsed: number }> {
  // 预处理 HTML
  const cleaned = cleanPageHtml(html);
  const truncated = truncateHtml(cleaned, MAX_HTML_BYTES);
  const sanitized = sanitizeForLLM(truncated);
  const summary = structuralSummary(html, bestUrl);

  console.log(`  🤖 LLM 分析 (HTML=${Buffer.byteLength(sanitized, "utf-8")}B, 摘要=${summary.length}chars)`);

  const prompt =
    `站点名称：${siteName}\n` +
    `页面 URL：${bestUrl}\n\n` +
    `结构摘要（候选模式和频率）：\n${summary}\n\n` +
    `清理后的 HTML（截断至 ${MAX_HTML_BYTES}B）：\n${sanitized}\n\n` +
    `只返回 JSON 对象。`;

  const { text, usage } = await withTimeout(
    generateText({
      model: getModel(),
      temperature: 0.1,
      maxRetries: 1,
      abortSignal: signal,
      system:
        "你是网页结构分析器。分析列表页的结构并提取 CSS 选择器和站点元数据。\n\n" +
        "选择器指南：\n" +
        "- listSelector：包含所有文章列表项的父容器（如 ul.news_list、div.article-list）\n" +
        "- itemSelector：单个文章条目（如 li、div.article-item、.news-card）。注意：这应该是 listSelector 的直接子元素\n" +
        "- linkSelector：条目内文章链接的 CSS 选择器（如 a.title-link、h3 a，或只填 a）\n" +
        "- titleSelector：详情页文章标题的选择器（如 h1、.article-title、header h1）\n" +
        "- bodySelector：详情页正文内容容器的选择器（如 div.content、article、.post-body、#article-content）\n" +
        "- dateSelector：列表页或详情页日期/时间的 CSS 选择器（如 time、.pub-date、span.date）\n\n" +
        "选择器必须能实际匹配页面中的元素。优先使用 class-based 选择器（如 .news-title），" +
        "其次使用 tag+class（如 div.news-title），最后使用纯 tag 选择器。\n" +
        "如果找不到明确的选择器，用合理默认值：listSelector=body, itemSelector=li, linkSelector=a。\n\n" +
        "分类指南：\n" +
        "- category：如 国家级科技部门、省级科技部门、安全公司、开源社区 等\n" +
        "- subcategory：如 国家级、省级、市级、威胁情报、漏洞库 等\n" +
        "- scope：简要描述该站点关注的科技情报主题/范围（1-2句话）\n\n" +
        "返回格式：\n" +
        '{"analysis":"页面结构简要分析","listSelector":"...","itemSelector":"...","linkSelector":"...","titleSelector":"...","bodySelector":"...","dateSelector":"...","category":"...","subcategory":"...","scope":"..."}',
      prompt,
      output: Output.text(),
    }),
    AI_TIMEOUT_MS,
  );

  const parsed = extractJson(text) as LlmAnalysisOutput;
  const tokensUsed = usage?.totalTokens ?? 0;
  console.log(`  ✅ LLM 完成 · ${tokensUsed} tokens`);
  console.log(`     listSelector: ${parsed.listSelector}`);
  console.log(`     itemSelector: ${parsed.itemSelector}`);
  console.log(`     category: ${parsed.category} / ${parsed.subcategory}`);

  return { result: parsed, tokensUsed };
}

// ── 确定性回退 ──

/**
 * 确定性选择器发现（inspect.ts/probe.ts 方法）。
 * 当 LLM 返回的选择器无法匹配任何条目时使用。
 */
function deterministicFallback(
  html: string,
  baseUrl: string,
): { selectors: Partial<LlmAnalysisOutput>; sampleLinks: string[] } {
  const $ = cheerio.load(html);

  const itemCounts = new Map<string, { count: number; samples: string[] }>();
  $("a[href]").each((_, a) => {
    const $a = $(a);
    const href = ($a.attr("href") || "").trim();
    const text = $a.text();
    if (!looksLikeArticle(text, href)) return;

    const $p = $a.parent();
    const tag = ($p.get(0) as { tagName?: string })?.tagName?.toLowerCase() || "?";
    const cls = ($p.attr("class") || "").split(/\s+/)[0];
    const key = cls ? `${tag}.${cls}` : tag;

    let entry = itemCounts.get(key);
    if (!entry) {
      entry = { count: 0, samples: [] };
      itemCounts.set(key, entry);
    }
    entry.count++;
    if (entry.samples.length < 3) {
      try {
        entry.samples.push(new URL(href, baseUrl).toString());
      } catch {
        // skip invalid URLs
      }
    }
  });

  const ranked = [...itemCounts.entries()]
    .sort((a, b) => b[1].count - a[1].count);

  if (ranked.length === 0) {
    return {
      selectors: {
        listSelector: "body",
        itemSelector: "li",
        linkSelector: "a",
      },
      sampleLinks: [],
    };
  }

  const best = ranked[0];
  return {
    selectors: {
      listSelector: best[0],
      itemSelector: best[0],
      linkSelector: "a",
    },
    sampleLinks: best[1].samples,
  };
}

// ── 选择器验证 ──

/**
 * 三层选择器验证：
 *   L1: parseList ≥3 条目 → 高置信度
 *   L2: 回退到确定性方法 → 中置信度
 *   L3: 默认兜底 → 低置信度
 */
function validateAndRefine(
  html: string,
  bestUrl: string,
  llmResult: LlmAnalysisOutput,
): {
  selectors: Partial<LlmAnalysisOutput>;
  sampleLinks: string[];
  confidence: "high" | "medium" | "low";
} {
  // L1: 验证 LLM 选择器
  const selectors = {
    listSelector: llmResult.listSelector,
    linkSelector: llmResult.linkSelector,
    titleSelector: llmResult.titleSelector,
    bodySelector: null as string | null,
    dateSelector: llmResult.dateSelector,
  };

  try {
    const items = parseList(html, bestUrl, selectors);
    if (items.length >= 3) {
      return {
        selectors: llmResult,
        sampleLinks: items.slice(0, 5).map((i) => i.url),
        confidence: "high",
      };
    }
    console.log(`  ⚠ LLM 选择器仅匹配 ${items.length} 条，回退到确定性方法`);
  } catch (e) {
    console.log(`  ⚠ LLM 选择器验证异常: ${(e as Error).message.slice(0, 60)}`);
  }

  // L2: 确定性回退
  const fallback = deterministicFallback(html, bestUrl);
  if (fallback.sampleLinks.length > 0 || fallback.selectors.listSelector !== "body") {
    console.log(`  🔧 确定性回退: listSelector=${fallback.selectors.listSelector}, links=${fallback.sampleLinks.length}`);
    return {
      selectors: { ...llmResult, ...fallback.selectors },
      sampleLinks: fallback.sampleLinks.slice(0, 5),
      confidence: "medium",
    };
  }

  // L3: 默认兜底
  console.log(`  ⚠ 兜底默认值`);
  return {
    selectors: {
      ...llmResult,
      listSelector: "body",
      itemSelector: "li",
      linkSelector: "a",
    },
    sampleLinks: [],
    confidence: "low",
  };
}

// ── 辅助 ──

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`操作超时 (${ms}ms)`)), ms);
    promise.then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

// ── 主入口 ──

export async function analyzeSite(input: {
  name: string;
  urls: string[];
  signal?: AbortSignal;
}): Promise<AnalyzeResult> {
  const startedAt = Date.now();
  console.log(`\n🔍 AI Site Analyzer: "${input.name}" · ${input.urls.length} URL(s)`);

  // 1) 渲染模式检测
  console.log("  ─ 阶段 1: 渲染模式检测 ─");
  const { bestHtml, bestUrl, render, staticWorked, dynamicWorked } =
    await detectRenderMode(input.urls, input.signal);

  console.log(`  🏆 最优: ${bestUrl.slice(0, 70)} [${modeLabel(render)}]`);

  // 2) LLM 分析
  console.log("  ─ 阶段 2: LLM 结构分析 ─");
  let llmResult: LlmAnalysisOutput;
  let tokensUsed = 0;

  try {
    const llm = await llmAnalyze(bestHtml, input.name, bestUrl, input.signal);
    llmResult = llm.result;
    tokensUsed = llm.tokensUsed;
  } catch (e) {
    if (input.signal?.aborted) throw e;
    console.log(`  ⚡ LLM 分析失败: ${(e as Error).message.slice(0, 80)}，回退到确定性方法`);
    const fallback = deterministicFallback(bestHtml, bestUrl);
    llmResult = {
      analysis: "LLM 失败，使用确定性回退",
      listSelector: fallback.selectors.listSelector || "body",
      itemSelector: fallback.selectors.itemSelector || "li",
      linkSelector: fallback.selectors.linkSelector || "a",
      titleSelector: fallback.selectors.titleSelector || "h1",
      bodySelector: fallback.selectors.bodySelector || "",
      dateSelector: fallback.selectors.dateSelector || "",
      category: "",
      subcategory: "",
      scope: "",
    };
  }

  // 3) 选择器验证
  console.log("  ─ 阶段 3: 选择器验证 ─");
  const validated = validateAndRefine(bestHtml, bestUrl, llmResult);

  const durationMs = Date.now() - startedAt;
  console.log(`  ✅ 完成 · ${durationMs}ms · 置信度: ${validated.confidence}\n`);

  return {
    category: llmResult.category || "",
    subcategory: llmResult.subcategory || "",
    render,
    listSelector: validated.selectors.listSelector || "body",
    itemSelector: validated.selectors.itemSelector || "li",
    linkSelector: validated.selectors.linkSelector || "a",
    titleSelector: validated.selectors.titleSelector || "h1",
    bodySelector: validated.selectors.bodySelector || "",
    dateSelector: validated.selectors.dateSelector || "",
    aiInvolvement: "extract_judge",
    scope: llmResult.scope || "",
    sampleLinks: validated.sampleLinks,
    diagnostics: {
      urlsTested: Math.min(input.urls.length, MAX_URLS_TO_TRY),
      staticWorked,
      dynamicWorked,
      bestUrl,
      tokensUsed,
      selectorConfidence: validated.confidence,
    },
  };
}
