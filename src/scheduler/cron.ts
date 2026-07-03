/**
 * 定时调度器：pnpm scheduler
 *
 * 读取全局 settings.cron_interval（默认 "0 9 * * *" 每天9点），按 cron 依次执行：
 *   采集 (crawl all) → AI 审核 (analyze all raw)。
 *
 * 环境变量：
 *   CRON_INTERVAL  — 兜底 cron 表达式，仅当 DB 中 settings.cron_interval 为空时使用
 */

import cron from "node-cron";
import PQueue from "p-queue";
import { pathToFileURL } from "node:url";
import { db, schema } from "../../db/client";
import { eq } from "drizzle-orm";
import { runSite } from "../pipeline/runner";
import { analyzePending } from "../ai/analyze";
import { closeBrowser } from "../crawler/playwright";
import { fire } from "../notify/notifier";

const DEFAULT_CRON = "0 9 * * *"; // 每天 9:00
const MAX_CONCURRENT = 2;

function getSchedule(): string {
  const row = db
    .select()
    .from(schema.settings)
    .where(eq(schema.settings.key, "cron_interval"))
    .get();
  if (row?.value) return row.value;
  // 兜底：环境变量或每天9点
  return process.env.CRON_INTERVAL ?? DEFAULT_CRON;
}

export async function runAll() {
  const started = Date.now();
  const interval = getSchedule();
  console.log(
    `[cron ${new Date().toISOString()}] 开始定时采集+审核（cron: ${interval}）…`,
  );

  const siteRows = db
    .select()
    .from(schema.sites)
    .where(eq(schema.sites.enabled, true))
    .all();

  const toRun = siteRows.filter((s) => !!s.listSelector);

  if (!toRun.length) {
    console.log("[cron] 无可用站点，跳过");
    return;
  }

  const queue = new PQueue({ concurrency: MAX_CONCURRENT });
  let crawled = 0;
  let errors = 0;

  for (const s of toRun) {
    queue.add(async () => {
      try {
        const r = await runSite(s);
        crawled += r.fetched;
      } catch (e) {
        errors++;
        console.error(
          `  [cron] #${s.id} ${s.name} 采集失败: ${(e as Error).message}`,
        );
      }
    });
  }

  await queue.onIdle();
  await closeBrowser().catch(() => {});

  // 审核所有 raw
  let analyzed = 0;
  try {
    const before = db
      .select({ id: schema.articles.id })
      .from(schema.articles)
      .where(eq(schema.articles.status, "raw"))
      .all().length;
    await analyzePending({ concurrency: 3 });
    const after = db
      .select({ id: schema.articles.id })
      .from(schema.articles)
      .where(eq(schema.articles.status, "raw"))
      .all().length;
    analyzed = before - after;
  } catch (e) {
    console.error(`  [cron] 审核失败: ${(e as Error).message}`);
  }

  const duration = ((Date.now() - started) / 1000).toFixed(0);
  console.log(
    `[cron] 完成：采集 ${crawled} 篇 · 审核 ${analyzed} 篇 · 错误 ${errors} · 耗时 ${duration}s`,
  );

  await fire({
    type: "scheduled_run",
    crawled,
    analyzed,
    durationSec: Number(duration),
  }).catch(() => {});
}

let task: cron.ScheduledTask | null = null;

async function main() {
  const interval = getSchedule();
  console.log(`[cron] 启动定时调度（${interval}）`);
  task = cron.schedule(interval, runAll);
  console.log(`[cron] 调度器就绪`);

  // 每分钟检查一次 cron 是否变更，热更新
  cron.schedule("*/1 * * * *", () => {
    const current = getSchedule();
    if (current !== interval && task) {
      console.log(`[cron] cron 变更: ${interval} → ${current}，热更新`);
      task.stop();
      task = cron.schedule(current, runAll);
    }
  });
}

const invokedDirectly =
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) main();
