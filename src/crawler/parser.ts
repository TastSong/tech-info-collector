/**
 * 选择器驱动的 HTML 解析。
 *  - parseList：从列表页抽取 {url, title, date}
 *  - parseDetail：从详情页抽取 {title, body, date}
 * 选择器来自 sites 表（listSelector / linkSelector / titleSelector / bodySelector / dateSelector）。
 */
import * as cheerio from "cheerio";

export interface Selectors {
  listSelector: string | null;
  linkSelector: string | null;
  titleSelector: string | null;
  bodySelector: string | null;
  dateSelector: string | null;
}

export interface ListItem {
  url: string;
  title: string;
  date: string | null;
}

export interface Detail {
  title: string;
  body: string;
  date: string | null;
}

/** 列表页解析：以 listSelector 圈定每个条目，条目内取链接/标题/日期。 */
export function parseList(
  html: string,
  baseUrl: string,
  s: Selectors,
): ListItem[] {
  const $ = cheerio.load(html);
  const out: ListItem[] = [];
  if (!s.listSelector) return out;

  $(s.listSelector).each((_, el) => {
    const $el = $(el);
    const $a = s.linkSelector
      ? $el.find(s.linkSelector).first()
      : $el.find("a").first();
    const href = $a.attr("href") || "";
    if (!href || href.startsWith("javascript:")) return;

    const title = (
      s.titleSelector
        ? $el.find(s.titleSelector).first().text()
        : $a.text() || $a.attr("title") || ""
    ).trim();
    if (!title) return;

    const date = s.dateSelector
      ? $el.find(s.dateSelector).first().text().trim() || null
      : null;

    let resolved: string;
    try {
      resolved = new URL(href, baseUrl).toString();
    } catch {
      return;
    }
    out.push({ url: resolved, title, date });
  });

  // 页内按 url 去重，保序
  const seen = new Set<string>();
  return out.filter((i) =>
    seen.has(i.url) ? false : (seen.add(i.url), true),
  );
}

/** 详情页解析：抽取标题、正文（清洗脚本/导航）、日期。
 *  正文策略：优先 bodySelector；若未配置或无命中，回退到通用主内容抽取
 *  （选取 <p> 数量与文本最长的容器），降低逐站配 body 选择器的负担。 */
export function parseDetail(html: string, s: Selectors): Detail {
  const $ = cheerio.load(html);

  const title = (
    s.titleSelector
      ? $(s.titleSelector).first().text()
      : $("h1").first().text() || $("title").first().text()
  ).trim();

  let body = "";
  if (s.bodySelector) {
    const $b = $(s.bodySelector).first();
    if ($b.length) {
      const $c = $b.clone();
      $c.find("script,style,nav,aside,form,.comment,.share,.breadcrumb").remove();
      body = $c
        .text()
        .replace(/[ \t]{2,}/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    }
  }
  if (!body) body = extractMainContent($);

  const date = s.dateSelector
    ? $(s.dateSelector).first().text().trim() || null
    : null;

  return { title, body: body.slice(0, 20000), date };
}

/** 通用主内容抽取：在 div/article/section 中，找含 ≥2 个 <p> 且清洗后文本最长者。 */
function extractMainContent($: cheerio.CheerioAPI): string {
  let best = "";
  $("div,article,section").each((_, el) => {
    const $el = $(el);
    if ($el.find("p").length < 2) return;
    const $c = $el.clone();
    $c.find("script,style,nav,aside,form,.comment,.share,.breadcrumb").remove();
    const text = $c
      .text()
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    if (text.length > best.length) best = text;
  });
  return best;
}
