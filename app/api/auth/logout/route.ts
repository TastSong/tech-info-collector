/**
 * POST /api/auth/logout — 退出登录。
 *
 * 清除服务端 token + cookie。
 */
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { db, schema } from "@/db/client";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function POST() {
  const cookieStore = await cookies();
  const token = cookieStore.get("auth_token")?.value;

  if (token) {
    db.update(schema.users)
      .set({ authToken: null })
      .where(eq(schema.users.authToken, token))
      .run();
  }

  cookieStore.set("auth_token", "", {
    httpOnly: true,
    secure: false,
    sameSite: "lax",
    path: "/",
    maxAge: 0, // 立即过期
  });

  return NextResponse.json({ ok: true });
}
