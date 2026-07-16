/**
 * GET /api/runs — 分页获取运行日志。
 *
 * Query params:
 *   page     — 页码 (默认 1)
 *   pageSize — 每页条数 (默认 30)
 *
 * Returns: { logs, total, page, pageSize, totalPages }
 */
import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db/client";
import { desc, sql } from "drizzle-orm";
import { requireAdmin } from "@/src/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = await requireAdmin();
  if (user instanceof NextResponse) return user;
  const { searchParams } = new URL(req.url);
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get("pageSize")) || 30));
  const offset = (page - 1) * pageSize;

  const totalRow = db
    .select({ c: sql<number>`COUNT(*)` })
    .from(schema.runLogs)
    .get();
  const total = totalRow?.c ?? 0;

  const logs = db
    .select()
    .from(schema.runLogs)
    .orderBy(desc(schema.runLogs.startedAt))
    .limit(pageSize)
    .offset(offset)
    .all()
    .map((r) => ({
      ...r,
      crawlSessionId: r.crawlSessionId,
      startedAt: r.startedAt?.toISOString() ?? null,
      endedAt: r.endedAt?.toISOString() ?? null,
    }));

  // 加载站点名 (只查本页涉及到的 siteId)
  const siteIds = [...new Set(logs.map((l) => l.siteId).filter(Boolean))];
  const siteNames: Record<number, string> = {};
  if (siteIds.length > 0) {
    const siteRows = db
      .select({ id: schema.sites.id, name: schema.sites.name })
      .from(schema.sites)
      .all();
    for (const s of siteRows) {
      siteNames[s.id] = s.name;
    }
  }

  return NextResponse.json({
    logs,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
    siteNames,
  });
}
