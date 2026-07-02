import { db, schema } from "@/db/client";
import { desc, sql, isNull, and, gte } from "drizzle-orm";
import { FeedCard } from "../components/FeedCard";

export default async function FeedPage() {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  // 近7天 + 未查看 的文章，JOIN sites 取 category
  const rows = db
    .select({
      id: schema.articles.id,
      title: schema.articles.title,
      fetchedAt: schema.articles.fetchedAt,
      publishedAt: schema.articles.publishedAt,
      siteId: schema.articles.siteId,
      siteName: schema.sites.name,
      category: schema.sites.category,
    })
    .from(schema.articles)
    .innerJoin(schema.sites, sql`${schema.articles.siteId} = ${schema.sites.id}`)
    .where(
      and(
        isNull(schema.articles.viewedAt),
        gte(schema.articles.fetchedAt, sevenDaysAgo),
      ),
    )
    .orderBy(desc(schema.articles.fetchedAt))
    .limit(100)
    .all();

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
          近 7 天未读 · {rows.length} 篇 · {ordered.length} 个分类
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
