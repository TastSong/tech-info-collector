/**
 * 容器级探针：pnpm tsx src/crawler/probe.ts <url...>
 * 对给定 url，统计"像文章"链接的「条目级」与「容器级」选择器，便于写出精确的
 * listSelector（如 `ul.news_list li` 而非泛 `li`）。仅静态抓取。
 */
import * as cheerio from "cheerio";
import { fetchHtml } from "./fetcher";

function looksLikeArticle(text: string, href: string): boolean {
  const t = text.trim();
  return t.length >= 6 && t.length <= 80 && !!href && !href.startsWith("javascript") && !href.startsWith("#");
}

async function main() {
  const urls = process.argv.slice(2);
  for (const url of urls) {
    console.log(`\n──── ${url} ────`);
    let html: string;
    try {
      html = await fetchHtml(url, "static");
    } catch (e) {
      console.log(`  ✗ ${(e as Error).message}`);
      continue;
    }
    const $ = cheerio.load(html);
    const items = new Map<string, number>();
    const containers = new Map<string, { n: number; sample: string[] }>();

    $("a").each((_, a) => {
      const $a = $(a);
      const href = $a.attr("href") || "";
      const text = $a.text();
      if (!looksLikeArticle(text, href)) return;

      // 条目级：直接父元素
      const $p = $a.parent();
      const ptag = ($p.get(0) as { tagName?: string })?.tagName?.toLowerCase() || "?";
      const pcls = ($p.attr("class") || "").split(/\s+/)[0];
      const ikey = pcls ? `${ptag}.${pcls}` : ptag;
      items.set(ikey, (items.get(ikey) || 0) + 1);

      // 容器级：向上找最近的带 class 的 ul/ol/div/section
      const $c = $a.parents("ul,ol,div,section").filter((_, el) => {
        const cls = $(el).attr("class") || "";
        const tag = (el as { tagName?: string }).tagName?.toLowerCase();
        return !!cls || tag === "ul" || tag === "ol";
      }).first();
      const ctag = ($c.get(0) as { tagName?: string })?.tagName?.toLowerCase() || "?";
      const ccls = ($c.attr("class") || "").split(/\s+/)[0];
      const ckey = ccls ? `${ctag}.${ccls}` : ctag;
      const ent = containers.get(ckey) || { n: 0, sample: [] };
      ent.n++;
      if (ent.sample.length < 4) ent.sample.push(text.trim().replace(/\s+/g, " ").slice(0, 48));
      containers.set(ckey, ent);
    });

    console.log("  -- 条目级 (item = 父元素) --");
    for (const [k, n] of [...items.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4)) {
      console.log(`     ${k}  ×${n}`);
    }
    console.log("  -- 容器级 (包裹元素) --");
    for (const [k, v] of [...containers.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 5)) {
      console.log(`     ${k}  ×${v.n}${v.n >= 5 ? "  ← 候选容器" : ""}`);
      for (const s of v.sample.slice(0, 2)) console.log(`        · ${s}`);
    }
  }
}

main();
