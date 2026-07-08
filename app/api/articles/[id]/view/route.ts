/**
 * POST /api/articles/[id]/view — 标记文章已查看，并联动标记同 content_hash 的文章。
 */
import { NextResponse } from "next/server";
import { db, schema } from "@/db/client";
import { eq, and, isNull } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const article = db
    .select({
      id: schema.articles.id,
      viewedAt: schema.articles.viewedAt,
      contentHash: schema.articles.contentHash,
    })
    .from(schema.articles)
    .where(eq(schema.articles.id, Number(id)))
    .get();

  if (!article) {
    return NextResponse.json({ error: "文章不存在" }, { status: 404 });
  }

  // 仅在尚未查看时才更新
  if (!article.viewedAt) {
    const now = new Date();

    db.update(schema.articles)
      .set({ viewedAt: now })
      .where(eq(schema.articles.id, Number(id)))
      .run();

    // 联动：同 content_hash 且未查看的文章也标记为已读
    if (article.contentHash) {
      db.update(schema.articles)
        .set({ viewedAt: now })
        .where(
          and(
            eq(schema.articles.contentHash, article.contentHash),
            isNull(schema.articles.viewedAt),
          ),
        )
        .run();
    }
  }

  return NextResponse.json({ ok: true });
}
