/**
 * POST /api/auth/login — 用户登录。
 *
 * Body: { username: string, password: string }
 *
 * 成功返回 200 + set-cookie，失败返回 401。
 */
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { db, schema } from "@/db/client";
import { verifyPassword, createSignedToken } from "@/src/lib/password";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: { username?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  const { username, password } = body;

  if (!username || !password) {
    return NextResponse.json({ error: "用户名和密码不能为空" }, { status: 400 });
  }

  const user = db
    .select()
    .from(schema.users)
    .where(eq(schema.users.username, username))
    .get();

  if (!user || !verifyPassword(password, user.passwordHash)) {
    return NextResponse.json({ error: "用户名或密码错误" }, { status: 401 });
  }

  // 自签名 token，支持多浏览器同时在线
  const authToken = createSignedToken(user.id, user.username);

  const cookieStore = await cookies();
  cookieStore.set("auth_token", authToken, {
    httpOnly: true,
    secure: false,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 天
  });

  return NextResponse.json({ ok: true, username: user.username });
}
