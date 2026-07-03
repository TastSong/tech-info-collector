/**
 * GET /api/auth/me — 获取当前登录用户信息。
 *
 * 通过 auth_token cookie 识别。未登录返回 null。
 */
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { db, schema } from "@/db/client";
import { verifySignedToken } from "@/src/lib/password";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get("auth_token")?.value;

  if (!token) {
    return NextResponse.json({ user: null });
  }

  const payload = verifySignedToken(token);
  if (!payload) {
    return NextResponse.json({ user: null });
  }

  // Verify user still exists
  const user = db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, payload.u))
    .get();

  if (!user) {
    return NextResponse.json({ user: null });
  }

  return NextResponse.json({
    user: {
      id: user.id,
      username: user.username,
    },
  });
}
