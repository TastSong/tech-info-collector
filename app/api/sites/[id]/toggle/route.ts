/**
 * POST /api/sites/[id]/toggle — 切换站点的启用/禁用状态。
 */
import { NextResponse } from "next/server";
import { db, schema } from "@/db/client";
import { eq } from "drizzle-orm";
import { requireAdmin } from "@/src/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireAdmin();
  if (user instanceof NextResponse) return user;

  const { id } = await params;

  const site = db
    .select()
    .from(schema.sites)
    .where(eq(schema.sites.id, Number(id)))
    .get();

  if (!site) {
    return NextResponse.json({ error: "站点不存在" }, { status: 404 });
  }

  db.update(schema.sites)
    .set({ enabled: !site.enabled })
    .where(eq(schema.sites.id, Number(id)))
    .run();

  return NextResponse.json({ ok: true, enabled: !site.enabled });
}
