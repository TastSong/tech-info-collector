/**
 * GET /api/health — 健康检查端点，无需登录。
 * 用于 Docker healthcheck。
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    time: new Date().toISOString(),
  });
}
