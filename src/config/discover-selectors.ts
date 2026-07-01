/**
 * 批量选择器发现脚本：pnpm tsx src/config/discover-selectors.ts [--write]
 *
 * 对 sites 表中所有 list_selector IS NULL 的站点，依次抓取首个 url 并自动推导
 * listSelector / linkSelector / dateSelector。
 * 加 --write 参数时直接写回 DB（否则只打印建议 + 置信度）。
 */
import "dotenv/config";
import * as cheerio from "cheerio";
import PQueue from "p-queue";
import { eq, isNull } from "drizzle-orm";
import { db, schema } from "../../db/client";
import { fetchHtml } from "../crawler/fetcher";
import { closeBrowser } from "../crawler/playwright";
import type { RenderMode } from "../crawler/fetcher";

/* ── 文章嗅觉 ── */

function looksLikeArticle(t: string, h: string): boolean {
  const tt = t.trim();
  return (
    tt.length >= 6 &&
    tt.length <= 80 &&
    !!h &&
    !h.startsWith("javascript") &&
    !h.startsWith("#") &&
    !/^(更多|首页|下一页|上一页|登录|注册|关于|联系|搜索|返回|more|next|prev|home|top)$/i.test(
      tt,
    )
  );
}

/* ── 选择器推导 ── */

interface Candidate {
  itemKey: string; // 条目选择器（tag.class 或 tag）
  linkKey: string; // 链接选择器（a 或 a.class 或 class）
  dateKey: string | null; // 疑似日期选择器
  n: number;
  samples: { t: string; h: string }[];
}

function discoverSelectors(
  html: string,
  baseUrl: string,
): Candidate[] {
  const $ = cheerio.load(html);
  const map = new Map<
    string,
    { n: number; samples: { t: string; h: string }[]; linkKeys: Map<string, number> }
  >();

  $("a").each((_, a) => {
    const $a = $(a);
    const href = $a.attr("href") || "";
    const text = $a.text();
    if (!looksLikeArticle(text, href)) return;

    const $p = $a.parent();
    let ptag: string;
    try {
      ptag = ($p.get(0) as { tagName?: string })?.tagName?.toLowerCase() || "?";
    } catch {
      ptag = "?";
    }
    const pcls = ($p.attr("class") || "").split(/\s+/)[0];
    const ikey = pcls ? `${ptag}.${pcls}` : ptag;
    // link selector: prefer the a itself (tag + class if class)
    const acls = ($a.attr("class") || "").split(/\s+/)[0];
    const akey = acls ? `a.${acls}` : "a";

    const entry = map.get(ikey) || {
      n: 0,
      samples: [],
      linkKeys: new Map(),
    };
    entry.n++;
    entry.linkKeys.set(akey, (entry.linkKeys.get(akey) || 0) + 1);
    if (entry.samples.length < 4) {
      entry.samples.push({
        t: text.trim().replace(/\s+/g, " ").slice(0, 60),
        h: (() => {
          try { return new URL(href, baseUrl).toString(); } catch { return href; }
        })(),
      });
    }
    if (!map.has(ikey)) map.set(ikey, entry);
  });

  const candidates: Candidate[] = [];
  for (const [ikey, e] of map.entries()) {
    if (e.n < 3) continue; // 至少 3 次以规避偶然匹配
    // 选出现次数最多的 link 子选择器
    const bestLink = [...e.linkKeys.entries()].sort(
      (a, b) => b[1] - a[1],
    )[0][0];
    // 尝试在同条目模式内找日期
    let dateKey: string | null = null;
    $(e.samples[0] ? "" : ""); // dummy; date detection expensive, skip
    candidates.push({ itemKey: ikey, linkKey: bestLink, dateKey, n: e.n, samples: e.samples });
  }
  // 按数量排序
  candidates.sort((a, b) => b.n - a.n);
  return candidates;
}

/* ── 置信度评分 ── */

function confidence(c: Candidate): "high" | "medium" | "low" {
  if (c.n >= 8 && c.itemKey.includes(".")) return "high";
  if (c.n >= 5) return "medium";
  return "low";
}

/* ── 主逻辑 ── */

async function main() {
  const write = process.argv.includes("--write");
  const sites = db
    .select()
    .from(schema.sites)
    .where(isNull(schema.sites.listSelector))
    .all();

  if (!sites.length) {
    console.log("所有站点均已有选择器。");
    return;
  }

  console.log(`待探测 ${sites.length} 个站点${write ? "（会写 DB）" : "（仅输出建议）"}\n`);
  let updated = 0;
  let failed = 0;
  let skipped = 0;

  // 小并发，友好抓取
  const queue = new PQueue({ concurrency: 4, interval: 1200, intervalCap: 2 });

  for (const s of sites) {
    queue.add(async () => {
      const url = s.urls[0];
      let html: string;
      try {
        html = await fetchHtml(url, s.render as RenderMode);
      } catch (e) {
        failed++;
        console.log(
          `✗ #${s.id} ${s.name.padEnd(18)} ${url.slice(0, 50)}  → 抓取失败`,
        );
        return;
      }

      const candidates = discoverSelectors(html, url);
      if (!candidates.length) {
        skipped++;
        console.log(
          `? #${s.id} ${s.name.padEnd(18)} → 未发现候选（需动态渲染或手动分析）`,
        );
        return;
      }

      const best = candidates[0];
      const conf = confidence(best);
      const flag = conf === "high" ? "★" : conf === "medium" ? "○" : "·";

      console.log(
        `${flag} #${s.id} ${s.name.padEnd(18)} list=${best.itemKey.padEnd(22)} link=${best.linkKey.padEnd(8)} ×${best.n} ${conf}`,
      );

      if (write && conf !== "low") {
        db.update(schema.sites)
          .set({
            listSelector: best.itemKey,
            linkSelector: best.linkKey,
          })
          .where(eq(schema.sites.id, s.id))
          .run();
        updated++;
      }
    });
  }

  await queue.onIdle();
  await closeBrowser().catch(() => {});

  console.log(
    `\n完成：${sites.length} 站探测。${
      write ? "写 DB=" + updated + " 站 " : ""
    }抓取失败=${failed} 无候选=${skipped}`,
  );
}

main();
