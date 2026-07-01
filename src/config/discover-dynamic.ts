/**
 * 批量选择器发现脚本（仅处理动态渲染失败的站点）
 * pnpm tsx src/config/discover-dynamic.ts [--write]
 *
 * 将 list_selector IS NULL 的站点全部改为 Playwright 动态渲染抓取，
 * 再重新探测。适用于首次静态抓取被屏蔽 / 超时的站点。
 */
import "dotenv/config";
import * as cheerio from "cheerio";
import { isNull, eq } from "drizzle-orm";
import PQueue from "p-queue";
import { db, schema } from "../../db/client";
import { fetchHtml } from "../crawler/fetcher";
import { closeBrowser } from "../crawler/playwright";

function looksLikeArticle(t: string, h: string): boolean {
  const tt = t.trim();
  return (
    tt.length >= 6 && tt.length <= 80 && !!h &&
    !h.startsWith("javascript") && !h.startsWith("#") &&
    !/^(更多|首页|下一页|上一页|登录|注册|关于|联系|搜索|返回|more|next|prev|home|top)$/i.test(tt)
  );
}
function discover(html: string, baseUrl: string) {
  const $ = cheerio.load(html);
  const map = new Map<string, { n: number; lk: Map<string, number>; s: { t: string; h: string }[] }>();
  $("a").each((_, a) => {
    const $a = $(a); const href = $a.attr("href") || ""; const text = $a.text();
    if (!looksLikeArticle(text, href)) return;
    const $p = $a.parent();
    const ptag = (($p.get(0) as any)?.tagName || "").toLowerCase();
    const pcls = ($p.attr("class") || "").split(/\s+/)[0];
    const ikey = pcls ? `${ptag}.${pcls}` : ptag;
    const acls = ($a.attr("class") || "").split(/\s+/)[0];
    const akey = acls ? `a.${acls}` : "a";
    const e = map.get(ikey) || { n: 0, lk: new Map(), s: [] };
    e.n++; e.lk.set(akey, (e.lk.get(akey) || 0) + 1);
    if (e.s.length < 3) {
      e.s.push({
        t: text.trim().replace(/\s+/g, " ").slice(0, 50),
        h: (() => { try { return new URL(href, baseUrl).toString(); } catch { return href; } })(),
      });
    }
    if (!map.has(ikey)) map.set(ikey, e);
  });
  return [...map.entries()].filter(([,e]) => e.n >= 3)
    .sort(([,a], [,b]) => b.n - a.n)
    .slice(0, 3)
    .map(([ikey, e]) => ({
      itemKey: ikey,
      linkKey: [...e.lk.entries()].sort((a, b) => b[1] - a[1])[0][0],
      n: e.n,
      samples: e.s,
    }));
}

async function main() {
  const write = process.argv.includes("--write");
  const sites = db.select().from(schema.sites).where(isNull(schema.sites.listSelector)).all();
  if (!sites.length) { console.log("所有站点均已有选择器。"); return; }
  console.log(`剩余未配选择器：${sites.length} 站（全部用 Playwright 动态渲染探测）\n`);

  let ok = 0, fail = 0;
  const q = new PQueue({ concurrency: 3, interval: 2000, intervalCap: 2 });
  for (const s of sites) {
    q.add(async () => {
      const url = s.urls[0];
      let html: string;
      try {
        html = await fetchHtml(url, "dynamic");
      } catch (e) {
        fail++;
        console.log(`✗ #${s.id} ${s.name.padEnd(20)} dynamic 也失败`);
        return;
      }
      const cs = discover(html, url);
      if (!cs.length) {
        fail++;
        console.log(`? #${s.id} ${s.name.padEnd(20)} dynamic 后仍无候选`);
        return;
      }
      const best = cs[0];
      const conf = best.n >= 8 ? "★" : best.n >= 5 ? "○" : "·";
      console.log(`${conf} #${s.id} ${s.name.padEnd(20)} list=${best.itemKey.padEnd(24)} link=${best.linkKey} ×${best.n}`);
      if (write) {
        db.update(schema.sites)
          .set({ listSelector: best.itemKey, linkSelector: best.linkKey, render: "dynamic" })
          .where(eq(schema.sites.id, s.id)).run();
        ok++;
      }
    });
  }
  await q.onIdle();
  await closeBrowser().catch(() => {});
  console.log(`\n完成：成功=${ok} 失败=${fail}`);
}
main();
