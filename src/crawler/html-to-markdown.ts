/**
 * HTML → Markdown 转换器。
 *
 * 将 parser.ts 清洗后的 HTML 转为 Markdown，供前端 react-markdown 渲染。
 * 相比于 .text() 方案，保留了标题、段落、列表、粗体、链接等语义。
 *
 * 安全性：turndown 只输出 Markdown，天然无 XSS 风险。
 */
import TurndownService from "turndown";

const turndown = new TurndownService({
  headingStyle: "atx",
  bulletListMarker: "-",
  codeBlockStyle: "fenced",
  linkStyle: "inlined",
});

/**
 * 将清洗后的 HTML 转为 Markdown。
 * 调用方（parser.ts）负责先通过 cheerio 移除噪音元素。
 */
export function htmlToMarkdown(html: string): string {
  if (!html || !html.trim()) return "";

  const md = turndown.turndown(html);

  // 压缩 3+ 连续空行为 2 个空行（保持段落间距）
  return md.replace(/\n{3,}/g, "\n\n").trim();
}
