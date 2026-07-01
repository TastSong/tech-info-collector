/**
 * 定时调度器：pnpm scheduler
 * 按环境变量 CRON_INTERVAL 指定的周期（默认每 6 小时），依次执行：
 *   采集 (crawl all) → AI 审核 (analyze all raw)。
 *
 * 环境变量：
 *   CRON_INTERVAL  — cron 表达式，默认 "0 */6 * * *"
 */
import cron from "node-cron";
import { pathToFileURL } from "node:url";
import { db, schema } from "../../db/client";
import { eq } from "drizzle-orm";
import { runSite } from "../pipeline/runner";
import { analyzePending } from "../ai/analyze";
import { closeBrowser } from "../crawler/playwright";
import { fire, type RunSummary } from "../notify/notifier";

const INTERVAL = process.env.CRON_INTERVAL ?? "0 */6 * * *";

export async function runAll() {
  const started = Date.now();
  console.log(`[cron ${new Date().toISOString()}] 开始定时采集+审核…`);

  const siteRows = db
    .select()
    .from(schema.sites)
    .where(eq(schema.sites.enabled, true))
    .all();

  let crawled = 0;
  for (const s of siteRows) {
    if (!s.listSelector) continue;
    try {
      const r = await runSite(s);
      crawled += r.fetched;
    } catch (e) {
      console.error(`  [cron] #${s.id} ${s.name} 采集失败: ${(e as Error).message}`);
    }
  }
  await closeBrowser().catch(() => {});

  // 审核所有 raw
  let analyzed = 0;
  try {
    const before = db
      .select()
      .from(schema.articles)
      .where(eq(schema.articles.status, "raw"))
      .all().length;
    await analyzePending({ concurrency: 3 });
    const after = db
      .select()
      .from(schema.articles)
      .where(eq(schema.articles.status, "raw"))
      .all().length;
    analyzed = before - after;
  } catch (e) {
    console.error(`  [cron] 审核失败: ${(e as Error).message}`);
  }

  const duration = ((Date.now() - started) / 1000).toFixed(0);
  console.log(
    `[cron] 完成：采集 ${crawled} 篇 · 审核 ${analyzed} 篇 · 耗时 ${duration}秒`,
  );

  await fire({
    type: "scheduled_run",
    crawled,
    analyzed,
    durationSec: Number(duration),
  }).catch(() => {});
}

async function main() {
  console.log(`[cron] 启动定时调度（${INTERVAL}）`);
  // 启动时不立即执行（避免与服务启动撞车）
  cron.schedule(INTERVAL, runAll);
  console.log(`[cron] 下次执行：稍后（按 ${INTERVAL}）`);
}

const invokedDirectly =
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) main();
