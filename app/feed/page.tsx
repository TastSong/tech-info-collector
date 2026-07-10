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

/** 日期分组标签（按"今天→昨天→本周→更早"降级），附带排序值 */
interface DateBucket {
  key: string;
  label: string;
  sort: number;
}

/** 判断一篇文章属于哪个日期桶（基于 Asia/Shanghai 时区） */
function getDateBucket(ts: Date): DateBucket {
  const fmt = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const now = new Date();
  const todayParts = fmt.format(now).split("/").map(Number);
  const dateParts = fmt.format(ts).split("/").map(Number);

  const todayDate = new Date(todayParts[0], todayParts[1] - 1, todayParts[2]);
  const articleDate = new Date(dateParts[0], dateParts[1] - 1, dateParts[2]);

  const diffDays = Math.round(
    (todayDate.getTime() - articleDate.getTime()) / 86400000,
  );

  if (diffDays === 0) {
    return { key: "today", label: "📅 今天", sort: 0 };
  }
  if (diffDays === 1) {
    return { key: "yesterday", label: "📅 昨天", sort: 1 };
  }

  // 本周 = 本周一到今天（不含今天/昨天已匹配的情况）
  const dayOfWeek = todayDate.getDay(); // 0=Sun
  const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const mondayDate = new Date(todayDate);
  mondayDate.setDate(todayDate.getDate() - daysSinceMonday);

  if (articleDate >= mondayDate) {
    return { key: "thisWeek", label: "📅 本周", sort: 2 };
  }

  return { key: "earlier", label: "📅 更早", sort: 3 };
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

  // 双层分组：日期桶 → category → articles
  // 日期桶顺序：今天 → 昨天 → 本周 → 更早
  // 每个桶内 category 按首次出现顺序排列
  const dateGroups = new Map<string, Map<string, typeof rows>>();
  const dateOrder: string[] = [];
  const catOrderInDate = new Map<string, string[]>();

  for (const r of rows) {
    const effectiveDate = r.publishedAt ?? r.fetchedAt;
    const bucket = getDateBucket(effectiveDate);

    if (!dateGroups.has(bucket.key)) {
      dateGroups.set(bucket.key, new Map());
      dateOrder.push(bucket.key);
      catOrderInDate.set(bucket.key, []);
    }

    const catMap = dateGroups.get(bucket.key)!;
    const cat = r.category ?? "未分类";
    const catOrder = catOrderInDate.get(bucket.key)!;

    if (!catMap.has(cat)) {
      catMap.set(cat, []);
      catOrder.push(cat);
    }
    catMap.get(cat)!.push(r);
  }

  // 构建排序后的分组结构
  const bucketInfos = Array.from(dateGroups.entries())
    .sort((a, b) => {
      // 用第一个文章的日期桶排序
      const sampleA = a[1].values().next().value?.[0];
      const sampleB = b[1].values().next().value?.[0];
      const dateA = sampleA?.publishedAt ?? sampleA?.fetchedAt ?? new Date(0);
      const dateB = sampleB?.publishedAt ?? sampleB?.fetchedAt ?? new Date(0);
      return (
        getDateBucket(dateA).sort - getDateBucket(dateB).sort
      );
    })
    .map(([bucketKey, catMap]) => {
      const catOrder = catOrderInDate.get(bucketKey) ?? [];
      const sortedCats = catOrder
        .filter((cat) => catMap.has(cat))
        .map((cat) => ({
          category: cat,
          articles: catMap.get(cat)!,
        }));

      // 构造标签
      const sample = sortedCats[0]?.articles[0];
      const sampleDate = sample?.publishedAt ?? sample?.fetchedAt ?? new Date();
      const { label } = getDateBucket(sampleDate);

      return { label, key: bucketKey, categories: sortedCats };
    });

  // 统计
  const totalArticles = rows.length;
  const totalCategories = new Set(rows.map((r) => r.category ?? "未分类")).size;

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">资讯流</h1>
        <p className="mt-1 text-sm text-slate-500">
          近 15 天未读 · {totalArticles} 篇 · {totalCategories} 个分类
        </p>
      </div>

      {!bucketInfos.length ? (
        <div className="rounded-xl border border-slate-200 bg-white p-12 text-center text-slate-400">
          暂无新资讯 ✓
        </div>
      ) : (
        <div className="space-y-10">
          {bucketInfos.map((bucket) => (
            <section key={bucket.key}>
              <h2 className="mb-4 flex items-center gap-2 text-base font-bold text-slate-800">
                {bucket.label}
                <span className="text-xs font-normal text-slate-400">
                  ({bucket.categories.reduce((sum, c) => sum + c.articles.length, 0)} 篇)
                </span>
              </h2>

              <div className="space-y-6">
                {bucket.categories.map((catGroup) => (
                  <div key={catGroup.category}>
                    <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-600">
                      <span className="inline-block h-1.5 w-1.5 rounded-full bg-indigo-400" />
                      {catGroup.category}
                      <span className="text-xs font-normal text-slate-400">
                        ({catGroup.articles.length})
                      </span>
                    </h3>
                    <div className="space-y-2">
                      {catGroup.articles.map((a) => (
                        <FeedCard key={a.id} article={a} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
