/**
 * 站点结构发现脚本：pnpm tsx src/crawler/inspect.ts [siteId]
 *
 * 对每个 enabled 站点的首个 url 抓取，统计"像文章链接"的 <a> 的直接父元素
 * 选择器模式（tag + 首个 class），输出出现次数最多的若干模式 + 样本链接，
 * 据此推导 listSelector / linkSelector / dateSelector。
 */
import { eq } from "drizzle-orm";
import * as cheerio from "cheerio";
import { db, schema } from "../../db/client";
import { fetchHtml } from "../crawler/fetcher";
import { closeBrowser } from "../crawler/playwright";

function looksLikeArticle(text: string, href: string): boolean {
  const t = text.trim();
  if (t.length < 6 || t.length > 80) return false;
  if (!href || href.startsWith("javascript") || href.startsWith("#")) return false;
  // 排除常见导航/功能锚文本
  if (/^(更多|首页|下一页|上一页|登录|注册|关于|联系|搜索|more|next|prev|home)/i.test(t))
    return false;
  return true;
}

async function inspect() {
  const idArg = process.argv[2];
  const id = idArg ? Number(idArg) : null;
  const sites = id
    ? db.select().from(schema.sites).where(eq(schema.sites.id, id)).all()
    : db.select().from(schema.sites).all();

  for (const s of sites) {
    console.log(`\n══════ #${s.id} ${s.name} [${s.render}] ══════`);
    for (const url of s.urls) {
      console.log(`\n  ── ${url}`);
      let html: string;
      try {
        html = await fetchHtml(url, s.render);
      } catch (e) {
        console.log(`  ✗ 抓取失败: ${(e as Error).message}`);
        continue;
      }

      const $ = cheerio.load(html);
      const title = $("title").first().text().trim();
      console.log(`  <title>: ${title.slice(0, 60)}`);

      const counts = new Map<
        string,
        { n: number; sample: { t: string; h: string }[] }
      >();
      $("a").each((_, a) => {
        const $a = $(a);
        const href = $a.attr("href") || "";
        const text = $a.text();
        if (!looksLikeArticle(text, href)) return;

        const $p = $a.parent();
        const tag =
          ($p.get(0) as { tagName?: string })?.tagName?.toLowerCase() || "?";
        const cls = ($p.attr("class") || "").split(/\s+/)[0];
        const key = cls ? `${tag}.${cls}` : tag;

        let entry = counts.get(key);
        if (!entry) {
          entry = { n: 0, sample: [] };
          counts.set(key, entry);
        }
        entry.n++;
        if (entry.sample.length < 6) {
          entry.sample.push({
            t: text.trim().replace(/\s+/g, " ").slice(0, 50),
            h: (() => {
              try {
                return new URL(href, url).toString();
              } catch {
                return href;
              }
            })(),
          });
        }
      });

      if (!counts.size) {
        console.log("  ⊘ 未发现像文章的链接（可能需要动态渲染或自定义选择器）");
        continue;
      }

      const ranked = [...counts.entries()]
        .sort((a, b) => b[1].n - a[1].n)
        .slice(0, 4);
      for (const [key, entry] of ranked) {
        console.log(
          `  ▸ ${key}  ×${entry.n}${entry.n >= 4 ? "   ← 候选 listSelector" : ""}`,
        );
        for (const s2 of entry.sample.slice(0, 3)) {
          console.log(`      · ${s2.t}`);
          console.log(`        ${s2.h}`);
        }
      }
    }
  }

  await closeBrowser();
}

inspect();
