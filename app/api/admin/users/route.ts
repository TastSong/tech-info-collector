/**
 * /api/admin/users — 用户管理 API（仅管理员）。
 *
 * GET  — 用户列表
 * POST — 创建新用户
 */
import { NextResponse } from "next/server";
import { db, schema } from "@/db/client";
import { requireAdmin } from "@/src/lib/auth";
import { hashPassword } from "@/src/lib/password";
import { eq, desc } from "drizzle-orm";

export const dynamic = "force-dynamic";

// GET — 用户列表
export async function GET() {
  const user = await requireAdmin();
  if (user instanceof NextResponse) return user;

  const users = db
    .select({
      id: schema.users.id,
      username: schema.users.username,
      role: schema.users.role,
      createdAt: schema.users.createdAt,
    })
    .from(schema.users)
    .orderBy(desc(schema.users.createdAt))
    .all();

  return NextResponse.json({ users });
}

// POST — 创建用户
export async function POST(req: Request) {
  const user = await requireAdmin();
  if (user instanceof NextResponse) return user;

  let body: { username?: string; password?: string; role?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  const username = (body.username ?? "").trim();
  const password = body.password ?? "";
  const role = body.role;

  // 校验用户名
  if (!username || username.length < 2 || username.length > 32) {
    return NextResponse.json({ error: "用户名长度需为 2-32 个字符" }, { status: 400 });
  }
  if (!/^[a-zA-Z0-9_一-鿿]+$/.test(username)) {
    return NextResponse.json({ error: "用户名只能包含中英文、数字和下划线" }, { status: 400 });
  }

  // 校验密码
  if (!password || password.length < 6 || password.length > 128) {
    return NextResponse.json({ error: "密码长度需为 6-128 个字符" }, { status: 400 });
  }

  // 校验角色
  if (role !== "admin" && role !== "user") {
    return NextResponse.json({ error: "角色必须是 admin 或 user" }, { status: 400 });
  }

  // 用户名唯一性检查
  const existing = db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.username, username))
    .get();
  if (existing) {
    return NextResponse.json({ error: "用户名已存在" }, { status: 400 });
  }

  const passwordHash = hashPassword(password);
  const result = db
    .insert(schema.users)
    .values({ username, passwordHash, role: role as "admin" | "user" })
    .run();

  return NextResponse.json(
    { id: Number(result.lastInsertRowid), username, role },
    { status: 201 },
  );
}
