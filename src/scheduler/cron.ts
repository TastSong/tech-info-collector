/**
 * 定时调度器
 *
 * 读取全局 settings.cron_interval（默认 "0 9 * * *" 每天9点），按 cron 周期执行：
 *   采集 (crawl all) → AI 审核 (analyze all raw)。
 *
 * 由 instrumentation hook 在 Next.js 启动时自动调用 startScheduler()；
 * 也可独立运行：pnpm scheduler（用于独立调度进程）。
 *
 * 核心采集编排逻辑已提取到 src/pipeline/service.ts。
 */

import cron, { type ScheduledTask } from "node-cron";
import { pathToFileURL } from "node:url";
import { db, schema } from "../../db/client";
import { eq } from "drizzle-orm";
import { runCrawl } from "../pipeline/service";
import { fire } from "../notify/notifier";

const DEFAULT_CRON = "0 9 * * *";
const MAX_CONCURRENT = 2;
const TZ = "Asia/Shanghai";

/**
 * 检查今天是否已过 cron 触发时间（以 Asia/Shanghai 为基准）。
 * 仅在 cron 触发时间到启动时间不足 5 分钟窗口时补执行 —
 *   - 正常的重启/重部署（down -v 后）：不补执行（除非恰好卡在 5 分钟窗口内）
 *   - cron 刚到触发时间但容器还没启动（典型场景）：补执行
 *   - 已有 running session 或今天已完成过：跳过
 */
let catchUpRunning = false;
const CATCH_UP_WINDOW_MIN = 5; // 仅在触发时间过后 5 分钟内补执行

async function maybeCatchUp(interval: string) {
  if (catchUpRunning) return;

  const parts = interval.trim().split(/\s+/);
  if (parts.length < 2) return;
  const cronHour = parseInt(parts[1], 10);
  const cronMin = parseInt(parts[0], 10);
  if (isNaN(cronHour) || isNaN(cronMin)) return;

  // 获取当前 Asia/Shanghai 时间
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  });
  const [h, m] = fmt.format(new Date()).split(":").map(Number);
  const nowMinutes = h * 60 + m;
  const triggerMinutes = cronHour * 60 + cronMin;

  // 还没到触发时间 → 跳过
  if (nowMinutes < triggerMinutes) {
    console.log(
      `[cron] 距离今天触发还有 ${triggerMinutes - nowMinutes} 分钟（${cronHour}:${String(cronMin).padStart(2, "0")} ${TZ}）`,
    );
    return;
  }

  // 距离触发时间已超过 CATCH_UP_WINDOW_MIN 分钟 → 不补执行（防止无关重启误触发）
  const minutesSinceTrigger = nowMinutes - triggerMinutes;
  if (minutesSinceTrigger > CATCH_UP_WINDOW_MIN) {
    console.log(
      `[cron] 已过触发时间 ${minutesSinceTrigger} 分钟（超过 ${CATCH_UP_WINDOW_MIN} 分钟窗口），不补执行`,
    );
    return;
  }

  // 检查是否已有正在运行的采集
  const runningSession = db
    .select({ id: schema.crawlSessions.id })
    .from(schema.crawlSessions)
    .where(eq(schema.crawlSessions.status, "running"))
    .limit(1)
    .all()
    .at(0);

  if (runningSession) {
    console.log(
      `[cron] 已有正在运行的采集（session #${runningSession.id}），跳过补执行`,
    );
    return;
  }

  const nowStr = new Date().toLocaleString("zh-CN", { timeZone: TZ });
  console.log(
    `[cron ${nowStr}] 触发时间刚过 ${minutesSinceTrigger} 分钟，补执行…`,
  );

  catchUpRunning = true;
  try {
    await runAll();
  } finally {
    catchUpRunning = false;
  }
}

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

  // 记录分析前的 raw 文章数，用于计算分析量
  const rawBefore = db
    .select({ id: schema.articles.id })
    .from(schema.articles)
    .where(eq(schema.articles.status, "raw"))
    .all().length;

  let crawled = 0;
  let errors = 0;
  let analyzed = 0;

  try {
    const { summary } = await runCrawl({
      concurrency: MAX_CONCURRENT,
      autoAnalyze: true,
    });

    crawled = summary.totalFetched;
    errors = summary.totalErrors;

    // 计算分析数量
    const rawAfter = db
      .select({ id: schema.articles.id })
      .from(schema.articles)
      .where(eq(schema.articles.status, "raw"))
      .all().length;
    analyzed = rawBefore - rawAfter;
  } catch (e) {
    console.error(`  [cron] 采集失败: ${(e as Error).message}`);
    errors++;
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

export async function startScheduler() {
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

  // 启动时检查是否错过了最近的触发窗口，补偿执行
  void maybeCatchUp(interval);
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
