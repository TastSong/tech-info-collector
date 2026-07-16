/**
 * POST /api/articles/[id]/save — 切换文章收藏/星标状态（当前用户）。
 *
 * 如果已收藏 (user_article_saves 中存在) → 取消收藏 (DELETE)
 * 如果未收藏                               → 添加收藏 (INSERT)
 *
 * Response: { ok: true, saved: boolean }
 */
import { NextResponse } from "next/server";
import { db, schema } from "@/db/client";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "@/src/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireAuth();
  if (user instanceof NextResponse) return user;

  const { id } = await params;

  const existing = db
    .select({ id: schema.userArticleSaves.id })
    .from(schema.userArticleSaves)
    .where(
      and(
        eq(schema.userArticleSaves.userId, user.id),
        eq(schema.userArticleSaves.articleId, Number(id)),
      ),
    )
    .get();

  if (existing) {
    // 取消收藏
    db.delete(schema.userArticleSaves)
      .where(eq(schema.userArticleSaves.id, existing.id))
      .run();
    return NextResponse.json({ ok: true, saved: false });
  } else {
    // 添加收藏
    db.insert(schema.userArticleSaves)
      .values({ userId: user.id, articleId: Number(id) })
      .run();
    return NextResponse.json({ ok: true, saved: true });
  }
}
