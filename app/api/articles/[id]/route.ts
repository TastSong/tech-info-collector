/**
 * PUT /api/articles/[id]  — 审批操作：approve（确认发布）或 reject（驳回）。
 * 权限/范围/持久化由代码控制，LLM 不参与。
 */
import { NextResponse } from "next/server";
import { db, schema } from "@/db/client";
import { eq } from "drizzle-orm";

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await req.json()) as { action?: string };
  const action = body.action;

  if (action !== "approve" && action !== "reject") {
    return NextResponse.json({ error: "action 须为 approve 或 reject" }, { status: 400 });
  }

  const article = db
    .select()
    .from(schema.articles)
    .where(eq(schema.articles.id, Number(id)))
    .get();

  if (!article) {
    return NextResponse.json({ error: "文章不存在" }, { status: 404 });
  }

  const newStatus = action === "approve" ? "published" : "rejected";
  db.update(schema.articles)
    .set({ status: newStatus })
    .where(eq(schema.articles.id, Number(id)))
    .run();

  return NextResponse.json({ ok: true, articleId: article.id, status: newStatus });
}
