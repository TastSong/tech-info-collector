/**
 * GET /api/feed — 分页查询资讯流文章（去重后）。
 *
 * Query params:
 *  - page     (default 1)
 *  - pageSize (default 30, max 100)
 *
 * Response: { articles: Array, total: number, page: number, pageSize: number, totalPages: number }
 * articles 中的日期字段是 Unix 秒数（客户端自行转为 Date）。
 */
import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

interface FeedRow {
  id: number;
  title: string | null;
  fetchedAt: number;
  publishedAt: number | null;
  siteId: number;
  siteName: string;
  category: string | null;
  summary: string | null;
  headline: string | null;
}

const PAGE_SIZE_MAX = 100;
const PAGE_SIZE_DEFAULT = 30;

/** 公共的 WHERE 过滤（time window + status + viewed） */
const FEED_WHERE = sql`
  a.viewed_at IS NULL
  AND a.status = 'published'
  AND (
    a.published_at >= CAST((unixepoch() - 1296000) AS INTEGER)
    OR (a.published_at IS NULL AND a.fetched_at >= CAST((unixepoch() - 1296000) AS INTEGER))
  )
`;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const pageSize = Math.min(
    PAGE_SIZE_MAX,
    Math.max(1, Number(searchParams.get("pageSize")) || PAGE_SIZE_DEFAULT),
  );
  const offset = (page - 1) * pageSize;

  // 去重后的文章总数
  const countResult = db.get(
    sql`
      SELECT COUNT(*) AS cnt FROM (
        SELECT 1 FROM articles a
        INNER JOIN sites s ON a.site_id = s.id
        LEFT JOIN ai_reviews r ON a.id = r.article_id
        WHERE ${FEED_WHERE}
        GROUP BY COALESCE(a.content_hash, '#' || a.id)
      )
    `,
  ) as { cnt: number } | undefined;
  const total = countResult?.cnt ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const rawRows = db.all(
      sql`
    SELECT
      id, title,
      fetched_at  AS "fetchedAt",
      published_at AS "publishedAt",
      site_id     AS "siteId",
      site_name   AS "siteName",
      category,
      summary,
      headline
    FROM (
      SELECT
        a.id, a.title, a.fetched_at, a.published_at, a.site_id,
        s.name   AS site_name,
        s.category,
        r.summary,
        r.headline,
        ROW_NUMBER() OVER (
          PARTITION BY COALESCE(a.content_hash, '#' || a.id)
          ORDER BY
            CASE WHEN r.id IS NOT NULL THEN 0 ELSE 1 END,
            COALESCE(a.published_at, a.fetched_at) DESC
        ) AS rn
      FROM articles a
      INNER JOIN sites s ON a.site_id = s.id
      LEFT JOIN ai_reviews r ON a.id = r.article_id
      WHERE ${FEED_WHERE}
    ) sub
    WHERE rn = 1
    ORDER BY COALESCE(published_at, fetched_at) DESC
    LIMIT ${pageSize} OFFSET ${offset}
  `,
  ) as unknown as FeedRow[];

  const articles = rawRows.map((r) => ({
    id: r.id,
    title: r.title,
    headline: r.headline,
    fetchedAt: r.fetchedAt,
    publishedAt: r.publishedAt,
    siteId: r.siteId,
    siteName: r.siteName,
    category: r.category,
    summary: r.summary,
  }));

  return NextResponse.json({ articles, total, page, pageSize, totalPages });
}
