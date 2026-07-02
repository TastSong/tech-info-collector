/**
 * POST /api/articles/[id]/view — 标记文章已查看（仅设置 viewed_at，不做其他操作）。
 */
import { NextResponse } from "next/server";
import { db, schema } from "@/db/client";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const article = db
    .select()
    .from(schema.articles)
    .where(eq(schema.articles.id, Number(id)))
    .get();

  if (!article) {
    return NextResponse.json({ error: "文章不存在" }, { status: 404 });
  }

  // 仅在尚未查看时才更新，避免重复写 timestamp
  if (!article.viewedAt) {
    db.update(schema.articles)
      .set({ viewedAt: new Date() })
      .where(eq(schema.articles.id, Number(id)))
      .run();
  }

  return NextResponse.json({ ok: true });
}
