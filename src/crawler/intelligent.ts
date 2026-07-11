/**
 * HTML 预处理工具。
 *
 * 提供：
 *  - sanitizeForLLM   — 过滤可见文本中的 prompt injection 模式
 *  - cleanPageHtml    — HTML 清洗（去除噪声标签/注释/空元素/事件属性）
 */
import * as cheerio from "cheerio";

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
