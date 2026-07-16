/**
 * 资讯流数据访问层。
 *
 * 将 feed 页面的原始 SQL 查询集中管理，避免在页面组件和 API 路由中重复。
 * 注：Drizzle 对 ROW_NUMBER + PARTITION BY 支持有限，去重查询仍使用原始 SQL。
 *
 * 多用户：所有查询均按 userId 隔离已读/收藏状态。
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
  savedAt: number | null;
}

export interface FeedQueryOptions {
  limit: number;
  offset: number;
}

/* ---------- helper ---------- */

/**
 * 内联 userId 到 SQL 字符串（纯整数，无注入风险）。
 * Drizzle 的 sql`` 会将 ${value} 转换为 ? 占位符，
 * 这里直接拼入数字以复用 SQL 片段。
 */
function uid(userId: number): string {
  return String(userId);
}

/* ---------- 公共 WHERE 片段 ---------- */

/**
 * 近 15 天未读（当前用户）、已发布。
 * 未读由 user_article_views 表判断。
 */
function feedWhere(userId: number) {
  const u = uid(userId);
  return sql`
  a.status = 'published'
  AND NOT EXISTS (
    SELECT 1 FROM user_article_views uv
    WHERE uv.user_id = ${u} AND uv.article_id = a.id
  )
  AND (
    a.published_at >= CAST((unixepoch() - 1296000) AS INTEGER)
    OR (a.published_at IS NULL AND a.fetched_at >= CAST((unixepoch() - 1296000) AS INTEGER))
  )
`;
}

/* ---------- 收藏 WHERE ---------- */

/** 收藏 WHERE（当前用户） */
function savedWhere(userId: number) {
  const u = uid(userId);
  return sql`
  a.status = 'published'
  AND EXISTS (
    SELECT 1 FROM user_article_saves us
    WHERE us.user_id = ${u} AND us.article_id = a.id
  )
`;
}

/* ---------- 已读历史 WHERE ---------- */

/** 已读历史 WHERE（当前用户） */
function historyWhere(userId: number) {
  const u = uid(userId);
  return sql`
  a.status = 'published'
  AND EXISTS (
    SELECT 1 FROM user_article_views uv
    WHERE uv.user_id = ${u} AND uv.article_id = a.id
  )
`;
}

/* ---------- 查询构建 ---------- */

/** 去重 + 排序子查询（不含 LIMIT/OFFSET），用于 feed 和 saved */
function dedupSelectBody(userId: number, whereClause: ReturnType<typeof sql>, extraColumn?: string) {
  const u = uid(userId);
  return sql`
    SELECT
      id, title,
      fetched_at  AS "fetchedAt",
      published_at AS "publishedAt",
      ${extraColumn ? sql`${sql.raw(extraColumn)},` : sql``}
      site_id     AS "siteId",
      site_name   AS "siteName",
      category,
      summary,
      headline,
      tags,
      quality_score AS "qualityScore",
      saved_at    AS "savedAt"
    FROM (
      SELECT
        a.id, a.title, a.fetched_at, a.published_at,
        ${extraColumn ? sql`${sql.raw(extraColumn)},` : sql``}
        a.site_id,
        s.name   AS site_name,
        s.category,
        r.summary,
        r.headline,
        r.tags,
        r.quality_score,
        us.saved_at,
        ROW_NUMBER() OVER (
          PARTITION BY COALESCE(a.content_hash, '#' || a.id)
          ORDER BY
            CASE WHEN r.id IS NOT NULL THEN 0 ELSE 1 END,
            COALESCE(a.published_at, a.fetched_at) DESC
        ) AS rn
      FROM articles a
      INNER JOIN sites s ON a.site_id = s.id
      LEFT JOIN ai_reviews r ON a.id = r.article_id
      LEFT JOIN user_article_saves us ON us.user_id = ${u} AND us.article_id = a.id
      WHERE ${whereClause}
    ) sub
    WHERE rn = 1
  `;
}

/** 去重 + 排序子查询（不含 LIMIT/OFFSET），用于已读历史 */
function historySelectBody(userId: number) {
  const u = uid(userId);
  return sql`
    SELECT
      id, title,
      fetched_at  AS "fetchedAt",
      published_at AS "publishedAt",
      viewed_at   AS "viewedAt",
      site_id     AS "siteId",
      site_name   AS "siteName",
      category,
      summary,
      headline,
      tags,
      quality_score AS "qualityScore",
      saved_at    AS "savedAt"
    FROM (
      SELECT
        a.id, a.title, a.fetched_at, a.published_at,
        uv.viewed_at,
        a.site_id,
        s.name   AS site_name,
        s.category,
        r.summary,
        r.headline,
        r.tags,
        r.quality_score,
        us.saved_at,
        ROW_NUMBER() OVER (
          PARTITION BY COALESCE(a.content_hash, '#' || a.id)
          ORDER BY
            CASE WHEN r.id IS NOT NULL THEN 0 ELSE 1 END,
            COALESCE(a.published_at, a.fetched_at) DESC
        ) AS rn
      FROM articles a
      INNER JOIN sites s ON a.site_id = s.id
      LEFT JOIN ai_reviews r ON a.id = r.article_id
      LEFT JOIN user_article_saves us ON us.user_id = ${u} AND us.article_id = a.id
      INNER JOIN user_article_views uv ON uv.user_id = ${u} AND uv.article_id = a.id
      WHERE ${historyWhere(userId)}
    ) sub
    WHERE rn = 1
  `;
}

/* ---------- Feed 未读文章 ---------- */

/** 获取去重后的未读文章总数（当前用户） */
export function countFeedArticles(userId: number): number {
  const result = db.get(
    sql`
    SELECT COUNT(*) AS cnt FROM (
      SELECT 1 FROM articles a
      INNER JOIN sites s ON a.site_id = s.id
      LEFT JOIN ai_reviews r ON a.id = r.article_id
      WHERE ${feedWhere(userId)}
      GROUP BY COALESCE(a.content_hash, '#' || a.id)
    )
  `,
  ) as { cnt: number } | undefined;
  return result?.cnt ?? 0;
}

/** 分页查询去重后的未读文章（按时间倒序） */
export function queryFeedArticles(opts: FeedQueryOptions, userId: number): FeedRow[] {
  const selectBody = dedupSelectBody(userId, feedWhere(userId));
  return db.all(
    sql`${selectBody}
    ORDER BY COALESCE(published_at, fetched_at) DESC
    LIMIT ${opts.limit} OFFSET ${opts.offset}`,
  ) as unknown as FeedRow[];
}

/* ---------- 已读历史 ---------- */

/** 已读历史列（多一个 viewedAt 字段） */
export interface HistoryRow extends FeedRow {
  viewedAt: number;
}

/** 获取已读历史文章总数（当前用户） */
export function countHistoryArticles(userId: number): number {
  const u = uid(userId);
  const result = db.get(
    sql`
    SELECT COUNT(*) AS cnt FROM (
      SELECT 1 FROM articles a
      INNER JOIN sites s ON a.site_id = s.id
      LEFT JOIN ai_reviews r ON a.id = r.article_id
      INNER JOIN user_article_views uv ON uv.user_id = ${u} AND uv.article_id = a.id
      WHERE ${historyWhere(userId)}
      GROUP BY COALESCE(a.content_hash, '#' || a.id)
    )
  `,
  ) as { cnt: number } | undefined;
  return result?.cnt ?? 0;
}

/** 分页查询已读历史（按 viewed_at 倒序） */
export function queryHistoryArticles(opts: FeedQueryOptions, userId: number): HistoryRow[] {
  return db.all(
    sql`${historySelectBody(userId)}
    ORDER BY viewed_at DESC
    LIMIT ${opts.limit} OFFSET ${opts.offset}`,
  ) as unknown as HistoryRow[];
}

/* ---------- 收藏文章查询 ---------- */

/** 获取收藏文章总数（当前用户） */
export function countSavedArticles(userId: number): number {
  const u = uid(userId);
  const result = db.get(
    sql`
    SELECT COUNT(*) AS cnt FROM (
      SELECT 1 FROM articles a
      INNER JOIN sites s ON a.site_id = s.id
      LEFT JOIN ai_reviews r ON a.id = r.article_id
      INNER JOIN user_article_saves us ON us.user_id = ${u} AND us.article_id = a.id
      WHERE ${savedWhere(userId)}
      GROUP BY COALESCE(a.content_hash, '#' || a.id)
    )
  `,
  ) as { cnt: number } | undefined;
  return result?.cnt ?? 0;
}

/** 分页查询收藏文章（按收藏时间倒序） */
export function querySavedArticles(opts: FeedQueryOptions, userId: number): FeedRow[] {
  const selectBody = dedupSelectBody(userId, savedWhere(userId));
  return db.all(
    sql`${selectBody}
    ORDER BY saved_at DESC
    LIMIT ${opts.limit} OFFSET ${opts.offset}`,
  ) as unknown as FeedRow[];
}
