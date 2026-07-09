/**
 * POST /api/sites/batch/toggle — 批量启用/禁用站点。
 *
 * Body: { ids: number[], enabled: boolean }
 */
import { NextResponse } from "next/server";
import { db, schema } from "@/db/client";
import { inArray } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }

  const ids: number[] = Array.isArray(body.ids)
    ? body.ids.filter((v: unknown) => typeof v === "number" && Number.isFinite(v))
    : [];

  if (ids.length === 0) {
    return NextResponse.json({ error: "ids 必须是非空数字数组" }, { status: 400 });
  }

  if (typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "enabled 必须是布尔值" }, { status: 400 });
  }

  const enabled = body.enabled as boolean;

  try {
    const result = db
      .update(schema.sites)
      .set({ enabled })
      .where(inArray(schema.sites.id, ids))
      .run();

    return NextResponse.json({
      ok: true,
      affected: result.changes,
      enabled,
    });
  } catch (e) {
    return NextResponse.json(
      { error: `批量更新失败: ${(e as Error).message}` },
      { status: 500 },
    );
  }
}
