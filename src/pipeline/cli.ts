/**
 * 采集 CLI：pnpm crawl [siteId]
 *   - 带站点 id：只跑该站点
 *   - 不带：跑所有 enabled 站点
 */
import { eq } from "drizzle-orm";
import { db, schema } from "../../db/client";
import { runSite } from "./runner";
import { closeBrowser } from "../crawler/playwright";

async function main() {
  const idArg = process.argv[2];
  const id = idArg ? Number(idArg) : null;

  const targets = id
    ? db.select().from(schema.sites).where(eq(schema.sites.id, id)).all()
    : db
        .select()
        .from(schema.sites)
        .where(eq(schema.sites.enabled, true))
        .all();

  if (!targets.length) {
    console.error(id ? `未找到站点 #${id}` : "没有 enabled 的站点");
    process.exit(1);
  }

  let totalFetched = 0;
  for (const s of targets) {
    console.log(`\n▶ #${s.id} ${s.name} [${s.render}]`);
    if (!s.listSelector) {
      console.log("  ⊘ 跳过：未配置选择器");
      continue;
    }
    try {
      const r = await runSite(s);
      console.log(
        `  ✓ 采集=${r.fetched} 跳过=${r.skipped} 错误=${r.errorCount} (${r.status})`,
      );
      totalFetched += r.fetched;
    } catch (e) {
      console.log(`  ✗ ${(e as Error).message}`);
    }
  }

  await closeBrowser();
  console.log(`\n完成，共采集 ${totalFetched} 篇新文章。`);
}

main();
