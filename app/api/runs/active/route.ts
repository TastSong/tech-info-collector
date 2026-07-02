import { NextResponse } from "next/server";
import { db, schema } from "@/db/client";
import { eq, desc } from "drizzle-orm";

/**
 * GET /api/runs/active — 返回当前在跑 + 最近完成的 run logs。
 * 前端轮询此接口来展示采集进度。
 */
export async function GET() {
  const running = db
    .select()
    .from(schema.runLogs)
    .where(eq(schema.runLogs.status, "running"))
    .orderBy(desc(schema.runLogs.startedAt))
    .all();

  // 最近 1 小时内完成的
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
