import { db } from "@/db/client";
import { sql } from "drizzle-orm";
import { FeedList } from "./FeedList";
import type { ArticleItem } from "./FeedList";

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

export default async function FeedPage() {
  const fifteenDaysAgoSec = Math.floor(
    (Date.now() - 15 * 24 * 60 * 60 * 1000) / 1000,
  );

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
      WHERE a.viewed_at IS NULL
        AND a.status = 'published'
        AND (
          a.published_at >= ${fifteenDaysAgoSec}
          OR (a.published_at IS NULL AND a.fetched_at >= ${fifteenDaysAgoSec})
        )
    ) sub
    WHERE rn = 1
    ORDER BY COALESCE(published_at, fetched_at) DESC
    LIMIT 100
  `,
  ) as unknown as FeedRow[];

  const articles: ArticleItem[] = rawRows.map((r) => ({
    id: r.id,
    title: r.title,
    headline: r.headline,
    fetchedAt: new Date(r.fetchedAt * 1000),
    publishedAt: r.publishedAt ? new Date(r.publishedAt * 1000) : null,
    siteId: r.siteId,
    siteName: r.siteName,
    category: r.category,
    summary: r.summary,
  }));

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">资讯流</h1>
      </div>

      <FeedList articles={articles} />
    </main>
  );
}
