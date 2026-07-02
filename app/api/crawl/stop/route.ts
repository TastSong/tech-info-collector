/**
 * POST /api/crawl/stop — 中止当前正在执行的采集任务。
 * 清空 PQueue + AbortController，将 running 状态的 run_logs 标记为 error。
 * 无论内存中的 controller 是否存在，始终清理 DB 中的残留 running 日志。
 */
import { NextResponse } from "next/server";
import { db, schema } from "@/db/client";
import { eq } from "drizzle-orm";
import { abortCrawl } from "@/src/pipeline/abort";
import { closeBrowser } from "@/src/crawler/playwright";

export async function POST() {
  abortCrawl();

  // 将所有 running 状态的 run_logs 标记为"用户中止"
  const running = db
    .select()
    .from(schema.runLogs)
    .where(eq(schema.runLogs.status, "running"))
    .all();

  const now = new Date();
  for (const r of running) {
    db.update(schema.runLogs)
      .set({
        status: "error",
        endedAt: now,
        message: "用户中止",
      })
      .where(eq(schema.runLogs.id, r.id))
      .run();
  }

  // 关掉浏览器
  await closeBrowser().catch(() => {});

  return NextResponse.json({
    stopped: true,
    abortedTasks: running.length,
  });
}
