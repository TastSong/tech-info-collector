/**
 * 资讯流数据访问层。
 *
 * 将 feed 页面的原始 SQL 查询集中管理，避免在页面组件和 API 路由中重复。
 * 注：Drizzle 对 ROW_NUMBER + PARTITION BY 支持有限，去重查询仍使用原始 SQL。
 */
import { db } from "@/db/client";
import { sql } from "drizzle-orm";

/* ---------- types ---------- */

/** 数据库返回的原始行（时间戳为 Unix 秒数整数） */
export interface FeedRow {
  id: number;
  title: string | null;
  fetchedAt: number;
  publishedAt: number | null;
  siteId: number;
  siteName: string;
  category: string | null;
  summary: string | null;
  headline: string | null;
  tags: string | null;          // JSON array string from SQLite
  qualityScore: number | null;
}

export interface FeedQueryOptions {
  limit: number;
  offset: number;
}

/* ---------- 公共 WHERE 片段 ---------- */

/** 近 15 天 + 未查看 + 已发布 */
export const FEED_WHERE = sql`
  a.viewed_at IS NULL
  AND a.status = 'published'
  AND (
    a.published_at >= CAST((unixepoch() - 1296000) AS INTEGER)
    OR (a.published_at IS NULL AND a.fetched_at >= CAST((unixepoch() - 1296000) AS INTEGER))
  )
`;

/** SQL 片段：去重主查询（不含 LIMIT/OFFSET，供调用方追加） */
const FEED_SELECT_BODY = sql`
  SELECT
    id, title,
    fetched_at  AS "fetchedAt",
    published_at AS "publishedAt",
    site_id     AS "siteId",
    site_name   AS "siteName",
    category,
    summary,
    headline,
    tags,
    quality_score AS "qualityScore"
  FROM (
    SELECT
      a.id, a.title, a.fetched_at, a.published_at, a.site_id,
      s.name   AS site_name,
      s.category,
      r.summary,
      r.headline,
      r.tags,
      r.quality_score,
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
`;

/* ---------- queries ---------- */

/** 获取去重后的未读文章总数 */
export function countFeedArticles(): number {
  const result = db.get(
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
  return result?.cnt ?? 0;
}

/** 分页查询去重后的未读文章（按时间倒序） */
export function queryFeedArticles(opts: FeedQueryOptions): FeedRow[] {
  return db.all(
    sql`${FEED_SELECT_BODY}
    LIMIT ${opts.limit} OFFSET ${opts.offset}`,
  ) as unknown as FeedRow[];
}
