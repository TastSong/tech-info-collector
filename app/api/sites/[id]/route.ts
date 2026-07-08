/**
 * /api/sites/[id] — 单站点 CRUD。
 *
 * GET    — 返回单站点完整数据
 * PATCH  — 更新站点字段
 * DELETE — 删除站点（有文章时阻止）
 */
import { NextResponse } from "next/server";
import { db, schema } from "@/db/client";
import { eq, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

/** 合法的可更新字段白名单 — 防止恶意注入 */
const EDITABLE_FIELDS = new Set([
  "name",
  "category",
  "subcategory",
  "urls",
  "render",
  "listSelector",
  "itemSelector",
  "linkSelector",
  "titleSelector",
  "bodySelector",
  "dateSelector",
  "aiInvolvement",
  "scope",
  "enabled",
]);

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const site = db
    .select()
    .from(schema.sites)
    .where(eq(schema.sites.id, Number(id)))
    .get();

  if (!site) {
    return NextResponse.json({ error: "站点不存在" }, { status: 404 });
  }

  return NextResponse.json(site);
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const site = db
    .select()
    .from(schema.sites)
    .where(eq(schema.sites.id, Number(id)))
    .get();

  if (!site) {
    return NextResponse.json({ error: "站点不存在" }, { status: 404 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }

  // 白名单过滤：只接受 editable 字段
  const updates: Record<string, unknown> = {};
  for (const key of Object.keys(body)) {
    if (!EDITABLE_FIELDS.has(key)) continue;
    updates[key] = body[key];
  }

  // 必填字段校验
  if (updates.name !== undefined) {
    if (typeof updates.name !== "string" || !updates.name.trim()) {
      return NextResponse.json({ error: "名称不能为空" }, { status: 400 });
    }
    updates.name = (updates.name as string).trim();
  }

  if (updates.render !== undefined) {
    if (!["static", "dynamic"].includes(updates.render as string)) {
      return NextResponse.json({ error: "render 必须是 static 或 dynamic" }, { status: 400 });
    }
  }

  if (updates.aiInvolvement !== undefined) {
    const valid = ["none", "extract", "extract_judge", "full"];
    if (!valid.includes(updates.aiInvolvement as string)) {
      return NextResponse.json(
        { error: `aiInvolvement 必须是 ${valid.join("/")}` },
        { status: 400 },
      );
    }
  }

  if (updates.enabled !== undefined) {
    if (typeof updates.enabled !== "boolean" && typeof updates.enabled !== "number") {
      return NextResponse.json({ error: "enabled 必须是布尔值" }, { status: 400 });
    }
    updates.enabled = !!(updates.enabled as boolean);
  }

  // urls 必须是数组
  if (updates.urls !== undefined) {
    if (!Array.isArray(updates.urls)) {
      return NextResponse.json({ error: "urls 必须是字符串数组" }, { status: 400 });
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json(site);
  }

  try {
    db.update(schema.sites)
      .set(updates as Partial<typeof schema.sites.$inferInsert>)
      .where(eq(schema.sites.id, Number(id)))
      .run();
  } catch (e) {
    return NextResponse.json(
      { error: `更新失败: ${(e as Error).message}` },
      { status: 500 },
    );
  }

  const updated = db
    .select()
    .from(schema.sites)
    .where(eq(schema.sites.id, Number(id)))
    .get();

  return NextResponse.json(updated);
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const site = db
    .select()
    .from(schema.sites)
    .where(eq(schema.sites.id, Number(id)))
    .get();

  if (!site) {
    return NextResponse.json({ error: "站点不存在" }, { status: 404 });
  }

  // 检查关联文章
  const articleCount = db
    .select({ c: sql<number>`COUNT(*)` })
    .from(schema.articles)
    .where(eq(schema.articles.siteId, Number(id)))
    .get();

  if (articleCount && articleCount.c > 0) {
    return NextResponse.json(
      { error: `该站点有 ${articleCount.c} 篇文章，请先清理后再删除` },
      { status: 409 },
    );
  }

  db.delete(schema.sites).where(eq(schema.sites.id, Number(id))).run();
  return NextResponse.json({ ok: true });
}
