import { db } from "@/db/client";
import { sql } from "drizzle-orm";
import { FeedCard } from "../components/FeedCard";

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

  // 近15天 + 未查看 + status=published + 按 content_hash 去重
  // ROW_NUMBER 分区：同 hash 的文章归为一组，优先选有 AI 摘要的，再按发布时间取最新
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

  // 将 Unix 时间戳转为 Date（还原 Drizzle timestamp mode 的行为）
  const rows = rawRows.map((r) => ({
    id: r.id,
    title: r.title,
    fetchedAt: new Date(r.fetchedAt * 1000),
    publishedAt: r.publishedAt ? new Date(r.publishedAt * 1000) : null,
    siteId: r.siteId,
    siteName: r.siteName,
    category: r.category,
    summary: r.summary,
    headline: r.headline,
  }));

  // 按 category 分组
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const cat = r.category ?? "未分类";
    const list = groups.get(cat);
    if (list) list.push(r);
    else groups.set(cat, [r]);
  }

  // 保持分组顺序（第一个出现的 category 在前）
  const ordered: { category: string; articles: typeof rows }[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const cat = r.category ?? "未分类";
    if (!seen.has(cat)) {
      seen.add(cat);
      ordered.push({ category: cat, articles: groups.get(cat)! });
    }
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">资讯流</h1>
        <p className="mt-1 text-sm text-slate-500">
          近 15 天未读 · {rows.length} 篇 · {ordered.length} 个分类
        </p>
      </div>

      {!ordered.length ? (
        <div className="rounded-xl border border-slate-200 bg-white p-12 text-center text-slate-400">
          暂无新资讯 ✓
        </div>
      ) : (
        <div className="space-y-8">
          {ordered.map((group) => (
            <section key={group.category}>
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-700">
                <span className="inline-block h-2 w-2 rounded-full bg-indigo-500" />
                {group.category}
                <span className="text-xs font-normal text-slate-400">
                  ({group.articles.length})
                </span>
              </h2>
              <div className="space-y-2">
                {group.articles.map((a) => (
                  <FeedCard key={a.id} article={a} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
