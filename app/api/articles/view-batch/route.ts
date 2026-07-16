/**
 * POST /api/articles/view-batch — 批量标记文章已查看（当前用户），含 content_hash 级联。
 *
 * Body: { ids: number[] }
 */
import { NextResponse } from "next/server";
import { db, schema } from "@/db/client";
import { eq, and, inArray } from "drizzle-orm";
import { requireAuth } from "@/src/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const user = await requireAuth();
  if (user instanceof NextResponse) return user;

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

  // 获取这些文章中的 content_hash（用于级联）
  const targets = db
    .select({
      id: schema.articles.id,
      contentHash: schema.articles.contentHash,
    })
    .from(schema.articles)
    .where(inArray(schema.articles.id, ids))
    .all();

  if (targets.length === 0) {
    return NextResponse.json({ ok: true, affected: 0 });
  }

  const now = new Date();

  // 为每篇目标文章插入已读记录（忽略已存在的）
  for (const t of targets) {
    try {
      db.insert(schema.userArticleViews)
        .values({ userId: user.id, articleId: t.id, viewedAt: now })
        .run();
    } catch {
      // 已存在，跳过
    }
  }

  // 级联：同 content_hash 的文章一起标记
  const hashes = [
    ...new Set(targets.map((t) => t.contentHash).filter(Boolean) as string[]),
  ];

  for (const hash of hashes) {
    const related = db
      .select({ id: schema.articles.id })
      .from(schema.articles)
      .where(eq(schema.articles.contentHash, hash))
      .all();

    for (const r of related) {
      if (targets.some((t) => t.id === r.id)) continue;
      try {
        db.insert(schema.userArticleViews)
          .values({ userId: user.id, articleId: r.id, viewedAt: now })
          .run();
      } catch {
        // 已存在，跳过
      }
    }
  }

  return NextResponse.json({ ok: true, affected: targets.length });
}
