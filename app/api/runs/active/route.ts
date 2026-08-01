import { NextResponse } from "next/server";
import { db, schema } from "@/db/client";
import { eq, desc, and, ne, sql } from "drizzle-orm";
import { requireAdmin } from "@/src/lib/auth";

export const dynamic = "force-dynamic";

// GET /api/runs/active — 返回当前在跑 + 最近完成的 run logs（带站点名 + session 汇总）
// running 日志只取 10 分钟内的，超过的视为僵尸（清理掉）
export async function GET() {
  const user = await requireAdmin();
  if (user instanceof NextResponse) return user;
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

  // 清理僵尸 runLogs（>10min 无进展）
  const now = new Date();
  for (const r of stale) {
    db.update(schema.runLogs)
      .set({ status: "error", endedAt: now, message: "超时未完成，自动标记为失败" })
      .where(eq(schema.runLogs.id, r.id))
      .run();
  }

  // 清理僵尸 analyze 会话（>30min 仍在 analyzing 状态）
  const analyzeCutoff = Date.now() - 30 * 60 * 1000;
  const staleSessions = db
    .select()
    .from(schema.crawlSessions)
    .where(eq(schema.crawlSessions.status, "analyzing"))
    .all()
    .filter((s) => {
      const ts = s.startedAt ? new Date(s.startedAt).getTime() : 0;
      return ts < analyzeCutoff;
    });
  for (const s of staleSessions) {
    db.update(schema.crawlSessions)
      .set({ status: "error", endedAt: now })
      .where(eq(schema.crawlSessions.id, s.id))
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

  // 查找站点名
  const siteNames = new Map<number, string>();
  const allSiteIds = new Set([
    ...running.map((r) => r.siteId),
    ...recent.map((r) => r.siteId),
  ]);
  if (allSiteIds.size > 0) {
    const sites = db
      .select({ id: schema.sites.id, name: schema.sites.name })
      .from(schema.sites)
      .all();
    for (const s of sites) {
      siteNames.set(s.id, s.name);
    }
  }

  // 当前 running session（含 analyzing 状态）
  const runningSession = db
    .select()
    .from(schema.crawlSessions)
    .where(
      sql`${schema.crawlSessions.status} IN ('running', 'analyzing')`,
    )
    .orderBy(desc(schema.crawlSessions.startedAt))
    .limit(1)
    .all()
    .at(0) ?? null;

  // 查询属于当前 session 且已完成的 runLogs（用于计算进度）
  let sessionCompleted = 0;
  if (runningSession) {
    const sessionLogs = db
      .select({ id: schema.runLogs.id, status: schema.runLogs.status })
      .from(schema.runLogs)
      .where(eq(schema.runLogs.crawlSessionId, runningSession.id))
      .all();
    sessionCompleted = sessionLogs.filter((l) => l.status !== "running").length;
  }

  // 当前阶段判定 + 分析进度
  let phase: "idle" | "crawling" | "analyzing" = "idle";
  let analyze: {
    remaining: number;
    processing: number;
  } | null = null;

  if (runningSession) {
    if (runningSession.status === "analyzing") {
      phase = "analyzing";
    } else if (running.length > 0) {
      phase = "crawling";
    } else {
      // running session 但没有 running log（可能刚启动）
      phase = "crawling";
    }

    // 分析阶段：统计文章处理进度
    if (phase === "analyzing") {
      const rawCount = db
        .select({ count: sql<number>`count(*)` })
        .from(schema.articles)
        .where(eq(schema.articles.status, "raw"))
        .all()
        .at(0)?.count ?? 0;
      const analyzingCount = db
        .select({ count: sql<number>`count(*)` })
        .from(schema.articles)
        .where(eq(schema.articles.status, "analyzing"))
        .all()
        .at(0)?.count ?? 0;
      analyze = {
        remaining: rawCount + analyzingCount,
        processing: analyzingCount,
      };
    }
  }

  const items = {
    running: running.map((r) => ({
      ...r,
      siteName: siteNames.get(r.siteId) ?? null,
    })),
    recent: recent.map((r) => ({
      ...r,
      siteName: siteNames.get(r.siteId) ?? null,
    })),
    session: runningSession
      ? {
          id: runningSession.id,
          status: runningSession.status,
          siteCount: runningSession.siteCount,
          completedCount: sessionCompleted,
        }
      : null,
    phase,
    analyze,
  };

  return NextResponse.json(items);
}
