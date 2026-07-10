/**
 * POST /api/articles/view-batch — 批量标记文章已查看，含 content_hash 级联。
 *
 * Body: { ids: number[] }
 */
import { NextResponse } from "next/server";
import { db, schema } from "@/db/client";
import { eq, inArray, isNull, and } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let ids: number[];
  try {
    const body = await req.json();
    if (!Array.isArray(body.ids)) {
      return NextResponse.json(
        { error: "ids 必须是数组" },
        { status: 400 },
      );
    }
    ids = body.ids
      .filter((v: unknown) => typeof v === "number" && Number.isFinite(v));
    if (ids.length === 0) {
      return NextResponse.json({ ok: true, affected: 0 });
    }
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }

  const now = new Date();

  // 1) 查询这些文章的 content_hash（仅未查看的）
  const targets = db
    .select({
      id: schema.articles.id,
      contentHash: schema.articles.contentHash,
    })
    .from(schema.articles)
    .where(
      and(
        inArray(schema.articles.id, ids),
        isNull(schema.articles.viewedAt),
      ),
    )
    .all();

  if (targets.length === 0) {
    return NextResponse.json({ ok: true, affected: 0 });
  }

  const targetIds = targets.map((t) => t.id);

  // 2) 直接标记这些文章
  db.update(schema.articles)
    .set({ viewedAt: now })
    .where(inArray(schema.articles.id, targetIds))
    .run();

  // 3) 级联：同 content_hash 且未查看的文章也标记
  const hashes = [
    ...new Set(targets.map((t) => t.contentHash).filter(Boolean) as string[]),
  ];
  if (hashes.length > 0) {
    db.update(schema.articles)
      .set({ viewedAt: now })
      .where(
        and(
          inArray(schema.articles.contentHash, hashes),
          isNull(schema.articles.viewedAt),
        ),
      )
      .run();
  }

  return NextResponse.json({ ok: true, affected: targetIds.length });
}
