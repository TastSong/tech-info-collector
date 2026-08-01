import { getCurrentUser } from "@/src/lib/auth";
import { countFeedArticles, queryTodayTop } from "@/src/data/feed";
import { getLatestDigest } from "@/src/ai/digest";
import { HomeDigest } from "./components/HomeDigest";
import { HomeTopPicks } from "./components/HomeTopPicks";
import Link from "next/link";
import { ArrowRight, Sparkles, Newspaper, Inbox } from "lucide-react";

export const dynamic = "force-dynamic";

const TOP_N = 10;

export default async function HomePage() {
  const user = await getCurrentUser();
  if (!user) return null; // middleware 已拦截，此处为安全兜底

  const digest = getLatestDigest();
  const rawTop = queryTodayTop(user.id, TOP_N);
  const unreadCount = countFeedArticles(user.id);

  const topArticles = rawTop.map((r) => ({
    id: r.id,
    title: r.headline || r.title || "(无标题)",
    summary: r.summary,
    siteName: r.siteName,
    category: r.category,
    qualityScore: r.qualityScore,
  }));

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      {/* Hero: Daily AI Digest */}
      <section className="mb-10">
        <HomeDigest digest={digest as { date: string; content: string; articleCount: number; createdAt: number } | null} />
      </section>

      {/* Today's Picks */}
      <section className="mb-10">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-xl font-bold text-slate-800 dark:text-slate-200">
            <Sparkles className="h-5 w-5 text-indigo-500" />
            今日精选
          </h2>
          <Link
            href="/feed"
            className="inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-500 dark:text-indigo-400 dark:hover:text-indigo-300 transition-colors"
          >
            查看全部资讯
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        {topArticles.length > 0 ? (
          <HomeTopPicks articles={topArticles} />
        ) : (
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-10 text-center">
            <Inbox className="mx-auto h-10 w-10 text-slate-300 dark:text-slate-600 mb-3" />
            <p className="text-slate-500 dark:text-slate-400 font-medium">
              今日暂无精选文章
            </p>
            <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
              等待新一轮采集分析完成后自动生成
            </p>
          </div>
        )}
      </section>

      {/* Quick Stats + CTA */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-6">
            <div>
              <p className="text-2xl font-bold text-slate-800 dark:text-slate-200">
                {unreadCount}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                未读文章
              </p>
            </div>
            {digest && (
              <div>
                <p className="text-2xl font-bold text-indigo-600 dark:text-indigo-400">
                  {digest.articleCount}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  今日摘要覆盖
                </p>
              </div>
            )}
          </div>
          <Link
            href="/feed"
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 transition-colors shadow-sm"
          >
            <Newspaper className="h-4 w-4" />
            浏览资讯流
          </Link>
        </div>
      </div>
    </main>
  );
}
