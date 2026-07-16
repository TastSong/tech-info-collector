/**
 * Auth 工具函数 — 从 cookie 获取当前用户、权限校验。
 *
 * 在 Node.js runtime 下工作（Edge middleware 无法使用 SQLite，
 * 因此 token 验证放在 layout 和各个 server component / API route 中）。
 */
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { db, schema } from "@/db/client";
import { eq } from "drizzle-orm";
import { verifySignedToken } from "./password";

export interface CurrentUser {
  id: number;
  username: string;
  role: "admin" | "user";
}

/**
 * 从 auth_token cookie 中解析当前用户。
 * 未登录或 token 无效返回 null。
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get("auth_token")?.value;
  if (!token) return null;

  const payload = verifySignedToken(token);
  if (!payload) return null;

  // 确认用户仍存在于数据库
  const user = db
    .select({ id: schema.users.id, username: schema.users.username, role: schema.users.role })
    .from(schema.users)
    .where(eq(schema.users.id, payload.u))
    .get();

  if (!user) return null;

  return {
    id: user.id,
    username: user.username,
    role: user.role as "admin" | "user",
  };
}

/**
 * 断言当前用户已登录，否则返回 401 响应。
 * 调用方检查返回值是否为 NextResponse 实例来判断是否中断。
 */
export async function requireAuth(): Promise<CurrentUser | NextResponse> {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }
  return user;
}

/**
 * 断言当前用户是 admin，否则返回 403 响应。
 * 调用方检查返回值是否为 NextResponse 实例来判断是否中断。
 */
export async function requireAdmin(): Promise<CurrentUser | NextResponse> {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }
  if (user.role !== "admin") {
    return NextResponse.json({ error: "无权限，仅管理员可操作" }, { status: 403 });
  }
  return user;
}
