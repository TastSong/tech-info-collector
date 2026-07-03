/**
 * 定时调度器
 *
 * 读取全局 settings.cron_interval（默认 "0 9 * * *" 每天9点），按 cron 周期执行：
 *   采集 (crawl all) → AI 审核 (analyze all raw)。
 *
 * 由 instrumentation hook 在 Next.js 启动时自动调用 startScheduler()；
 * 也可独立运行：pnpm scheduler（用于独立调度进程）。
 */

import cron, { type ScheduledTask } from "node-cron";
import PQueue from "p-queue";
import { pathToFileURL } from "node:url";
import { db, schema } from "../../db/client";
import { eq } from "drizzle-orm";
import { runSite } from "../pipeline/runner";
import { analyzePending } from "../ai/analyze";
import { closeBrowser } from "../crawler/playwright";
import { fire } from "../notify/notifier";

const DEFAULT_CRON = "0 9 * * *";
const MAX_CONCURRENT = 2;
const TZ = "Asia/Shanghai";

function getSchedule(): string {
  const row = db
    .select()
    .from(schema.settings)
    .where(eq(schema.settings.key, "cron_interval"))
    .get();
  if (row?.value) return row.value;
  return process.env.CRON_INTERVAL ?? DEFAULT_CRON;
}

export async function runAll() {
  const started = Date.now();
  const interval = getSchedule();
  const now = new Date().toLocaleString("zh-CN", { timeZone: TZ });
  console.log(
    `[cron ${now}] 开始定时采集+审核（cron: ${interval}）…`,
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

let mainTask: ScheduledTask | null = null;
let watchTask: ScheduledTask | null = null;

export function startScheduler() {
  const interval = getSchedule();
  console.log(`[cron] 启动定时调度（cron: ${interval}，时区: ${TZ}）`);

  mainTask = cron.schedule(
    interval,
    runAll,
    { timezone: TZ },
  );

  // 每分钟检测 cron 变更并热更新
  let currentCron = interval;
  watchTask = cron.schedule(
    "*/1 * * * *",
    () => {
      const latest = getSchedule();
      if (latest !== currentCron && mainTask) {
        console.log(`[cron] cron 变更: ${currentCron} → ${latest}，热更新`);
        mainTask.stop();
        mainTask = cron.schedule(
          latest,
          runAll,
          { timezone: TZ },
        );
        currentCron = latest;
      }
    },
    { timezone: TZ },
  );
}

export function stopScheduler() {
  mainTask?.stop();
  watchTask?.stop();
}

const invokedDirectly =
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  startScheduler();
}
