/**
 * POST /api/feed/clear — 一键追平：服务端批量将"早于截止时间"的未读 published 文章标记为已读。
 *
 * 不受分页限制（与 view-batch 的"仅当前页"不同），用于解决多日积压。
 *
 * Query params:
 *  - mode = keep2 (默认) 保留近 2 天（昨天及更早全部已读）
 *  - mode = today      只保留今天
 *  - mode = all        清空全部未读
 *
 * 截止时间按 Asia/Shanghai 日历日对齐（与 FeedList 日期桶一致）。
 * 不做 content_hash 级联：保留同 hash 的较新文章自然留在 feed 中。
 *
 * Response: { ok, affected, mode }
 */
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { requireAuth } from "@/src/lib/auth";

export const dynamic = "force-dynamic";

const DAY = 86400;
const TZ = "Asia/Shanghai";

/**
 * 计算 Asia/Shanghai 时区「今天午夜」往前 keepDays 天的 unix 时间戳（秒）。
 * keepDays=0 → 今天 00:00；keepDays=2 → 前天 00:00。
 */
function shanghaiCutoffSecs(keepDays: number): number {
  const fmt = new Intl.DateTimeFormat("zh-CN", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const [y, m, d] = fmt.format(new Date()).split("/").map(Number);
  // (y,m,d) 00:00:00+08:00 对应的 UTC ms = Date.UTC(y,m-1,d) - 8h
  const shanghaiMidnightMs = Date.UTC(y, m - 1, d) - 8 * 3600 * 1000;
  return Math.floor((shanghaiMidnightMs - keepDays * DAY * 1000) / 1000);
}

export async function POST(req: Request) {
  const user = await requireAuth();
  if (user instanceof NextResponse) return user;

  const mode = new URL(req.url).searchParams.get("mode") ?? "keep2";

  // cutoff: 早于此时间戳的文章 → 标记已读
  const cutoff =
    mode === "all"
      ? Math.floor(Date.now() / 1000) + 1 // 未来时间戳 → 全部未读清空
      : mode === "today"
        ? shanghaiCutoffSecs(0)
        : shanghaiCutoffSecs(2); // keep2

  const result = db.run(sql`
    INSERT OR IGNORE INTO user_article_views (user_id, article_id, viewed_at)
    SELECT ${user.id}, a.id, unixepoch()
    FROM articles a
    WHERE a.status = 'published'
      AND COALESCE(a.published_at, a.fetched_at) < ${cutoff}
      AND NOT EXISTS (
        SELECT 1 FROM user_article_views uv
        WHERE uv.user_id = ${user.id} AND uv.article_id = a.id
      )
  `);

  const affected = (result as { changes?: number }).changes ?? 0;
  return NextResponse.json({ ok: true, affected, mode });
}
