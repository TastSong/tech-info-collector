/**
 * /api/sites — 站点列表 API。
 *
 * GET  — 返回全部站点，附带文章计数
 * POST — 创建新站点
 */
import { NextResponse } from "next/server";
import { db, schema } from "@/db/client";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  const sites = db.select().from(schema.sites).all();

  const counts = new Map(
    db
      .select({
        siteId: schema.articles.siteId,
        c: sql<number>`COUNT(*)`,
      })
      .from(schema.articles)
      .groupBy(schema.articles.siteId)
      .all()
      .map((r) => [r.siteId, r.c]),
  );

  const result = sites.map((s) => ({
    ...s,
    articleCount: counts.get(s.id) ?? 0,
  }));

  return NextResponse.json(result);
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }

  // 必填字段校验
  if (!body.name || typeof body.name !== "string" || !body.name.trim()) {
    return NextResponse.json({ error: "name 必填" }, { status: 400 });
  }

  const urls: string[] = Array.isArray(body.urls) ? body.urls.filter((u: unknown) => typeof u === "string" && u.trim()) : [];
  const render = (["static", "dynamic"].includes(body.render as string)
    ? body.render
    : "static") as "static" | "dynamic";
  const aiInvolvement = (["none", "extract", "extract_judge", "full"].includes(
    body.aiInvolvement as string,
  )
    ? body.aiInvolvement
    : "extract_judge") as "none" | "extract" | "extract_judge" | "full";

  const values = {
    name: (body.name as string).trim(),
    category: (body.category as string) || null,
    subcategory: (body.subcategory as string) || null,
    urls,
    render,
    aiInvolvement,
    enabled: !!body.enabled,
    scope: (body.scope as string) || null,
    listSelector: (body.listSelector as string) || null,
    itemSelector: (body.itemSelector as string) || null,
    linkSelector: (body.linkSelector as string) || null,
    titleSelector: (body.titleSelector as string) || null,
    bodySelector: (body.bodySelector as string) || null,
    dateSelector: (body.dateSelector as string) || null,
  };

  try {
    const result = db.insert(schema.sites).values(values).run();
    return NextResponse.json(
      { id: Number(result.lastInsertRowid) },
      { status: 201 },
    );
  } catch (e) {
    return NextResponse.json(
      { error: `创建失败: ${(e as Error).message}` },
      { status: 500 },
    );
  }
}
