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

  const siteRows = db
    .select()
    .from(schema.sites)
    .where(eq(schema.sites.enabled, true))
    .all();

  const toRun = siteRows.filter((s) => s.aiInvolvement !== "none");

  if (!toRun.length) {
    console.log("[cron] 无可用站点，跳过");
    return;
  }

  // 创建 crawl session，使前端能显示总进度
  const sessionId = (
    db
      .insert(schema.crawlSessions)
      .values({
        startedAt: new Date(),
        status: "running",
        siteCount: toRun.length,
      })
      .run().lastInsertRowid as number
  ) ?? 1;

  const queue = new PQueue({ concurrency: MAX_CONCURRENT });
  let crawled = 0;
  let errors = 0;
  let totalUpdated = 0;
  let totalSkipped = 0;

  for (const s of toRun) {
    queue.add(async () => {
      try {
        const r = await runSite(s, sessionId);
        crawled += r.fetched;
        totalUpdated += r.updated;
        totalSkipped += r.skipped;
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

  // 汇总 session 结果
  const sessionStatus: typeof schema.crawlSessions.$inferInsert.status =
    errors > 0 && crawled === 0 ? "error"
    : errors > 0 ? "partial"
    : "success";

  db.update(schema.crawlSessions)
    .set({
      endedAt: new Date(),
      status: sessionStatus,
      totalFetched: crawled,
      totalUpdated,
      totalSkipped,
      totalErrors: errors,
    })
    .where(eq(schema.crawlSessions.id, sessionId))
    .run();

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
