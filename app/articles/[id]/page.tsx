import Link from "next/link";
import { notFound } from "next/navigation";
import { db, schema } from "@/db/client";
import { eq, desc } from "drizzle-orm";
import { ArticleActions } from "../../components/ActionButtons";
import { statusBadge } from "../../components/Badges";
import { MarkViewed } from "../../components/MarkViewed";

export const dynamic = "force-dynamic";

export default async function ArticleDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams; // from=feed → 调整返回链接

  const article = db
    .select()
    .from(schema.articles)
    .where(eq(schema.articles.id, Number(id)))
    .get();
  if (!article) return notFound();

  const site = db
    .select()
    .from(schema.sites)
    .where(eq(schema.sites.id, article.siteId))
    .get();

  const review = db
    .select()
    .from(schema.aiReviews)
    .where(eq(schema.aiReviews.articleId, article.id))
    .orderBy(desc(schema.aiReviews.createdAt))
    .get();

  const backHref = sp.from === "feed" ? "/feed" : "/articles";
  const backLabel = sp.from === "feed" ? "← 返回资讯流" : "← 文章";

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <MarkViewed articleId={article.id} />

      <div className="mb-4 flex items-center gap-3 text-sm text-slate-500">
        <Link href={backHref} className="hover:text-slate-900">
          {backLabel}
        </Link>
        <span>·</span>
        <span>{site?.name ?? `站点#${article.siteId}`}</span>
      </div>

      {/* Title + status */}
      <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <h1 className="flex-1 text-xl font-bold text-slate-900">
          {article.title}
        </h1>
        <div className="flex items-center gap-3 shrink-0">
          {statusBadge(article.status)}
          <ArticleActions
            articleId={article.id}
            currentStatus={article.status}
          />
        </div>
      </div>

      {/* Meta */}
      <div className="mb-6 flex gap-6 text-sm text-slate-500">
        {article.publishedAt ? (
          <span>
            发布时间：{new Date(article.publishedAt).toLocaleString("zh-CN")}
          </span>
        ) : null}
        <span>采集时间：{new Date(article.fetchedAt!).toLocaleString("zh-CN")}</span>
      </div>

      {/* AI Review Panel (right) + Body (left) */}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3 lg:gap-8">
        {/* Body */}
        <div className="lg:col-span-2">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">正文</h2>
          <div className="prose prose-slate max-w-none rounded-xl border border-slate-200 bg-white p-6 text-sm leading-relaxed whitespace-pre-line">
            {article.body || "(无正文)"}
          </div>
        </div>

        {/* AI Review */}
        <div className="lg:col-span-1">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">
            AI 审核 ({review?.model ?? "未分析"})
          </h2>
          {review ? (
            <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex flex-col gap-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-400">相关性</span>
                  <span className={review.relevant ? "text-emerald-600" : "text-red-500"}>
                    {review.relevant ? "✓ 相关" : "✗ 无关"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">可用性</span>
                  <span className={review.usable ? "text-emerald-600" : "text-red-500"}>
                    {review.usable ? "✓ 可用" : "✗ 不可用"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">质量分</span>
                  <span className="font-medium">
                    {review.qualityScore?.toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">tokens</span>
                  <span>{review.tokensUsed ?? "-"}</span>
                </div>
              </div>

              <div>
                <div className="mb-1 text-xs font-medium text-slate-500">
                  摘要
                </div>
                <p className="text-sm text-slate-700">{review.summary}</p>
              </div>

              {review.keyPoints ? (
                <div>
                  <div className="mb-1 text-xs font-medium text-slate-500">
                    关键点
                  </div>
                  <ul className="list-disc pl-4 text-sm text-slate-700 space-y-0.5">
                    {review.keyPoints.map(
                      (kp: string, i: number) => (
                        <li key={i}>{kp}</li>
                      ),
                    )}
                  </ul>
                </div>
              ) : null}

              {review.tags ? (
                <div>
                  <div className="mb-1 text-xs font-medium text-slate-500">
                    标签
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {review.tags.map(
                      (t: string) => (
                        <span
                          key={t}
                          className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600"
                        >
                          {t}
                        </span>
                      ),
                    )}
                  </div>
                </div>
              ) : null}

              <div>
                <div className="mb-1 text-xs font-medium text-slate-500">
                  判断理由
                </div>
                <p className="text-sm text-slate-600 italic">
                  {review.reason}
                </p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-400">
              尚未经 AI 分析（文章状态: {article.status}）
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
