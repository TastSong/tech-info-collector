/**
 * GET /api/feed/digest — 获取最新一条每日 AI 摘要。
 *
 * Response: { digest: { date, content, articleCount, createdAt } | null }
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/src/lib/auth";
import { getLatestDigest } from "@/src/ai/digest";

export const dynamic = "force-dynamic";

export async function GET(_req: Request) {
  const user = await requireAuth();
  if (user instanceof NextResponse) return user;

  const digest = getLatestDigest();
  return NextResponse.json({ digest });
}
