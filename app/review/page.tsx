import Link from "next/link";
import { db, schema } from "@/db/client";
import { eq, asc, desc } from "drizzle-orm";
import { statusBadge } from "../components/Badges";
import { ArticleActions } from "../components/ActionButtons";

export default async function ReviewPage() {
  const reviewArticles = db
    .select()
    .from(schema.articles)
    .where(eq(schema.articles.status, "review"))
    .orderBy(asc(schema.articles.fetchedAt))
    .all();

  // 带 AI review
  const reviewMap = new Map(
    db
      .select()
      .from(schema.aiReviews)
      .where(
        // 只取 review 文章的最新审核
        // simpler: select all and filter
      )
      .all()
      .map((r) => [r.articleId, r]),
  );

  // Actually fetch ai_reviews per article — use a join or batch
  const allReviews = db.select().from(schema.aiReviews).all();
  const reviewOf = new Map(allReviews.map((r) => [r.articleId, r]));

  const sites = db.select().from(schema.sites).all();
  const nameOf = new Map(sites.map((s) => [s.id, s.name]));

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">待人工复核</h1>
        <p className="mt-1 text-sm text-slate-500">
          {reviewArticles.length} 篇文章需要你判断（AI 判定灰区或偏离范围）
        </p>
      </div>

      {!reviewArticles.length ? (
        <div className="rounded-xl border border-slate-200 bg-white p-12 text-center text-slate-400">
          暂无待复核文章 ✓
        </div>
      ) : (
        <div className="space-y-4">
          {reviewArticles.map((a) => {
            const r = reviewOf.get(a.id);
            return (
              <div
                key={a.id}
                className="rounded-xl border border-amber-200 bg-white p-5"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <Link
                      href={`/articles/${a.id}`}
                      className="font-medium text-slate-900 hover:text-indigo-600 line-clamp-1"
                    >
                      {a.title}
                    </Link>
                    <div className="mt-1 flex items-center gap-3 text-xs text-slate-400">
                      <span>{nameOf.get(a.siteId) ?? `#${a.siteId}`}</span>
                      {r ? (
                        <>
                          <span className="text-amber-600">
                            q={r.qualityScore?.toFixed(2)}
                          </span>
                          <span>{r.reason}</span>
                        </>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {statusBadge("review")}
                    <ArticleActions
                      articleId={a.id}
                      currentStatus="review"
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
