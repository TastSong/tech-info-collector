/**
 * 采集 CLI：pnpm crawl [siteId]
 *   - 带站点 id：只跑该站点
 *   - 不带：跑所有 enabled 站点（按域名分组并行，环境变量 CRAWL_CONCURRENCY 控制并发数，默认 10）
 *
 * 思路：不同域名的限流队列独立，所以可以并行；同域名站点共享限流，组内串行。
 */
import { eq } from "drizzle-orm";
import PQueue from "p-queue";
import { db, schema } from "../../db/client";
import { runSite } from "./runner";
import { closeBrowser } from "../crawler/playwright";
import { analyzePending } from "../ai/analyze";
import { isIntelligentCrawlEnabled } from "../ai/intelligent-crawl";

const CONCURRENCY = Number(process.env.CRAWL_CONCURRENCY ?? 10);

/** 按站点首个 url 的 host 分组，同域名站点串行，跨域名并行。 */
function groupByHost(
  sites: (typeof schema.sites.$inferSelect)[],
): (typeof schema.sites.$inferSelect)[][] {
  const map = new Map<string, (typeof schema.sites.$inferSelect)[]>();
  for (const s of sites) {
    let host = "unknown";
    try { host = new URL(s.urls[0]).host; } catch {}
    const list = map.get(host);
    if (list) list.push(s);
    else map.set(host, [s]);
  }
  return [...map.values()];
}

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

  // 有无选择器的站点分开
  // 有选择器的正常采集；无选择器但启用智能爬虫的也纳入采集
  const intelligentEnabled = isIntelligentCrawlEnabled();
  const ready = targets.filter((s) =>
    s.listSelector || (intelligentEnabled && s.aiInvolvement !== "none")
  );
  const skipped = targets.filter((s) => !ready.includes(s));
  for (const s of skipped) {
    console.log(`⊘ #${s.id} ${s.name} — 未配置选择器且智能爬虫未启用，跳过`);
  }

  if (!ready.length) {
    console.log("无可用站点。");
    process.exit(0);
  }

  // 按域名分组
  const groups = groupByHost(ready);
  // 创建 crawl session
  const sessionCount = db.select().from(schema.crawlSessions).all().length;
  const sessionIndex = sessionCount + 1;
  const sessionId = (
    db
      .insert(schema.crawlSessions)
      .values({
        startedAt: new Date(),
        status: "running",
        siteCount: ready.length,
      })
      .run().lastInsertRowid as number
  ) ?? 1;

  console.log(`\n=== 第 ${sessionIndex} 次采集 ===`);
  console.log(
    `并行采集 ${ready.length} 站 (${groups.length} 域名组) · 并发=${CONCURRENCY}\n`,
  );

  const q = new PQueue({ concurrency: CONCURRENCY });
  let totalFetched = 0;

  for (const group of groups) {
    q.add(async () => {
      // 组内串行（同域名共享限流队列，并行无益且可能触发反爬）
      for (const s of group) {
        process.stdout.write(`▶ #${s.id} ${s.name} [${s.render}] ...`);
        try {
          const r = await runSite(s, sessionId);
          console.log(
            ` ✓ 新${r.fetched} 变${r.updated} 跳${r.skipped} 错${r.errorCount} (${r.status})`,
          );
          totalFetched += r.fetched + r.updated;
        } catch (e) {
          console.log(` ✗ ${(e as Error).message}`);
        }
      }
    });
  }

  await q.onIdle();
  await closeBrowser();

  // 汇总 session 结果
  const sessionRuns = db
    .select()
    .from(schema.runLogs)
    .where(eq(schema.runLogs.crawlSessionId, sessionId))
    .all();
  const totalErrors = sessionRuns.reduce((s, r) => s + r.errorCount, 0);
  const totalUpdated = sessionRuns.reduce((s, r) => s + r.updated, 0);
  const totalSkipped = sessionRuns.reduce((s, r) => s + r.skipped, 0);
  const hasErrors = totalErrors > 0;
  const hasPartial = sessionRuns.some((r) => r.status === "partial");
  const status: typeof schema.crawlSessions.$inferInsert.status =
    hasErrors && totalFetched === 0 ? "error"
    : hasPartial || hasErrors ? "partial"
    : "success";

  db.update(schema.crawlSessions)
    .set({
      endedAt: new Date(),
      status,
      totalFetched,
      totalUpdated,
      totalSkipped,
      totalErrors,
    })
    .where(eq(schema.crawlSessions.id, sessionId))
    .run();

  console.log(`\n采集完成，共采集 ${totalFetched} 篇新文章。`);

  // 采集完成后自动对 raw 文章做 AI 分析
  console.log("开始 AI 分析…");
  await analyzePending({ concurrency: CONCURRENCY });
  console.log("AI 分析完成。");
}

main();
