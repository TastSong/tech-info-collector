/**
 * Lightpanda 站点兼容性测试脚本。
 * 对 DB 中所有 render = 'dynamic' 的站点，逐一用 Lightpanda 抓取首页，
 * 验证 HTML 是否"有意义"（文本长度 >= 200, 链接数 >= 3）。
 *
 * 用法：docker compose exec app pnpm tsx src/crawler/test-lightpanda.ts [--migrate]
 *
 *   --migrate  ：将验证通过的站点 render 改为 'lightpanda'
 */
import "dotenv/config";
import { eq } from "drizzle-orm";
import { db, schema } from "../../db/client";
import { fetchWithLightpanda, closeLightpanda } from "../crawler/lightpanda";
import * as cheerio from "cheerio";

const MEANINGFUL_MIN_TEXT = 200;
const MEANINGFUL_MIN_LINKS = 3;

function isMeaningfulHtml(html: string): boolean {
  const $ = cheerio.load(html);
  const textLen = $("body").text().trim().length;
  const linkCount = $("a[href]").length;
  return textLen >= MEANINGFUL_MIN_TEXT && linkCount >= MEANINGFUL_MIN_LINKS;
}

async function main() {
  const migrate = process.argv.includes("--migrate");

  const sites = db
    .select()
    .from(schema.sites)
    .where(eq(schema.sites.render, "dynamic"))
    .all();

  console.log(`\n🔍 Lightpanda 兼容性测试 — ${sites.length} 个 dynamic 站点${migrate ? " (会写DB)" : " (仅测试)"}\n`);

  const results: { name: string; urls: string[]; success: boolean; error?: string; textLen?: number; linkCount?: number }[] = [];
  let passed = 0;
  let failed = 0;

  for (const s of sites) {
    const url = s.urls[0];
    process.stdout.write(`  📡 ${s.name.padEnd(20)} (${url.slice(0, 50)}) ... `);
    try {
      const html = await fetchWithLightpanda(url, { timeoutMs: 20_000 });
      if (isMeaningfulHtml(html)) {
        const $ = cheerio.load(html);
        const textLen = $("body").text().trim().length;
        const linkCount = $("a[href]").length;
        console.log(`✅ ${html.length}B · text=${textLen} · links=${linkCount}`);
        results.push({ name: s.name, urls: s.urls, success: true, textLen, linkCount });
        passed++;
      } else {
        const $ = cheerio.load(html);
        const textLen = $("body").text().trim().length;
        const linkCount = $("a[href]").length;
        console.log(`⚠️ 无意义 (text=${textLen}, links=${linkCount})`);
        results.push({ name: s.name, urls: s.urls, success: false, error: "无意义内容", textLen, linkCount });
        failed++;
      }
    } catch (e) {
      const msg = (e as Error).message.slice(0, 80);
      console.log(`❌ ${msg}`);
      results.push({ name: s.name, urls: s.urls, success: false, error: msg });
      failed++;
    }
  }

  await closeLightpanda().catch(() => {});

  console.log(`\n📊 结果：${passed} 通过 · ${failed} 失败 (共 ${sites.length})\n`);

  if (passed > 0) {
    console.log("✅ 通过的站点：");
    for (const r of results.filter((r) => r.success)) {
      console.log(`  · ${r.name}`);
    }
  }

  if (failed > 0) {
    console.log("\n❌ 失败的站点：");
    for (const r of results.filter((r) => !r.success)) {
      console.log(`  · ${r.name} — ${r.error}`);
    }
  }

  if (migrate && passed > 0) {
    console.log("\n📝 迁移中（render: dynamic → lightpanda）...");
    for (const r of results.filter((r) => r.success)) {
      const s = db.select().from(schema.sites).where(eq(schema.sites.name, r.name)).all()[0];
      if (s) {
        db.update(schema.sites)
          .set({ render: "lightpanda" })
          .where(eq(schema.sites.id, s.id))
          .run();
        console.log(`  ✅ ${s.name} → lightpanda`);
      }
    }
    console.log(`\n已迁移 ${passed} 个站点。`);
  }
}

main();
