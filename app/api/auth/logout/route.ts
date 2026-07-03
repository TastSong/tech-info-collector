/**
 * POST /api/auth/logout — 退出登录。
 *
 * 清除服务端 token + cookie。
 */
import { NextResponse } from "next/server";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

export async function POST() {
  const cookieStore = await cookies();

  cookieStore.set("auth_token", "", {
    httpOnly: true,
    secure: false,
    sameSite: "lax",
    path: "/",
    maxAge: 0, // 立即过期
  });

  return NextResponse.json({ ok: true });
}
