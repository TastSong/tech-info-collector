/**
 * POST /api/articles/[id]/save — 切换文章收藏/星标状态。
 *
 * 如果已收藏 (saved_at IS NOT NULL) → 取消收藏 (SET NULL)
 * 如果未收藏 (saved_at IS NULL)     → 收藏 (SET now)
 *
 * Response: { ok: true, saved: boolean }
 */
import { NextResponse } from "next/server";
import { db, schema } from "@/db/client";
import { eq, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const article = db
    .select({ id: schema.articles.id, savedAt: schema.articles.savedAt })
    .from(schema.articles)
    .where(eq(schema.articles.id, Number(id)))
    .get();

  if (!article) {
    return NextResponse.json({ error: "文章不存在" }, { status: 404 });
  }

  const currentlySaved = article.savedAt != null;

  if (currentlySaved) {
    // 取消收藏
    db.update(schema.articles)
      .set({ savedAt: null })
      .where(eq(schema.articles.id, Number(id)))
      .run();
  } else {
    // 添加收藏
    db.update(schema.articles)
      .set({ savedAt: sql`(unixepoch())` })
      .where(eq(schema.articles.id, Number(id)))
      .run();
  }

  return NextResponse.json({ ok: true, saved: !currentlySaved });
}
