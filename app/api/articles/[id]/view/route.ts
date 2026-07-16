/**
 * POST /api/articles/[id]/view — 标记文章已查看（当前用户）。
 *
 * 联动：同 content_hash 且当前用户未查看的文章也会被标记。
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

  const article = db
    .select({
      id: schema.articles.id,
      contentHash: schema.articles.contentHash,
    })
    .from(schema.articles)
    .where(eq(schema.articles.id, Number(id)))
    .get();

  if (!article) {
    return NextResponse.json({ error: "文章不存在" }, { status: 404 });
  }

  // 检查当前用户是否已查看
  const existing = db
    .select({ id: schema.userArticleViews.id })
    .from(schema.userArticleViews)
    .where(
      and(
        eq(schema.userArticleViews.userId, user.id),
        eq(schema.userArticleViews.articleId, Number(id)),
      ),
    )
    .get();

  if (!existing) {
    const now = new Date();

    // 插入当前用户的已读记录
    try {
      db.insert(schema.userArticleViews)
        .values({ userId: user.id, articleId: Number(id), viewedAt: now })
        .run();
    } catch {
      // 忽略重复键冲突
    }

    // 联动：同 content_hash 且当前用户未查看的文章也标记
    if (article.contentHash) {
      const relatedArticles = db
        .select({ id: schema.articles.id })
        .from(schema.articles)
        .where(eq(schema.articles.contentHash, article.contentHash))
        .all();

      for (const related of relatedArticles) {
        if (related.id === Number(id)) continue;
        try {
          db.insert(schema.userArticleViews)
            .values({ userId: user.id, articleId: related.id, viewedAt: now })
            .run();
        } catch {
          // 忽略重复键冲突
        }
      }
    }
  }

  return NextResponse.json({ ok: true });
}
