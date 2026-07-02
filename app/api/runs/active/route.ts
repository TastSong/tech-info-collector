import { NextResponse } from "next/server";
import { db, schema } from "@/db/client";
import { eq, desc } from "drizzle-orm";

export const dynamic = "force-dynamic";

// GET /api/runs/active — 返回当前在跑 + 最近完成的 run logs
// running 日志只取 10 分钟内的，超过的视为僵尸（清理掉）
export async function GET() {
  const allRunning = db
    .select()
    .from(schema.runLogs)
    .where(eq(schema.runLogs.status, "running"))
    .orderBy(desc(schema.runLogs.startedAt))
    .all();

  const cutoff = Date.now() - 10 * 60 * 1000;

  const running: typeof allRunning = [];
  const stale: typeof allRunning = [];

  for (const r of allRunning) {
    const ts = r.startedAt ? new Date(r.startedAt).getTime() : 0;
    if (ts < cutoff) {
      stale.push(r);
    } else {
      running.push(r);
    }
  }

  const now = new Date();
  for (const r of stale) {
    db.update(schema.runLogs)
      .set({ status: "error", endedAt: now, message: "超时未完成，自动标记为失败" })
      .where(eq(schema.runLogs.id, r.id))
      .run();
  }

  const recent = db
    .select()
    .from(schema.runLogs)
    .where(eq(schema.runLogs.status, "success"))
    .orderBy(desc(schema.runLogs.endedAt))
    .limit(20)
    .all()
    .filter((r) => {
      if (!r.endedAt) return false;
      return Date.now() - new Date(r.endedAt).getTime() < 60 * 60 * 1000;
    });

  return NextResponse.json({ running, recent });
}
