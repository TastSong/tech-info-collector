import Link from "next/link";
import { Star } from "lucide-react";

interface TopArticle {
  id: number;
  title: string;
  summary: string | null;
  siteName: string;
  category: string | null;
  qualityScore: number | null;
}

/**
 * 首页「今日精选」卡片网格。
 *
 * 展示当日按 quality_score 排名的 Top N 文章，
 * 每张卡片可点击跳转到文章详情页。
 */
export function HomeTopPicks({ articles }: { articles: TopArticle[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {articles.map((a, i) => (
        <Link
          key={a.id}
          href={`/articles/${a.id}`}
          className="group rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 hover:border-indigo-300 dark:hover:border-indigo-700 hover:shadow-md transition-all"
        >
          <div className="mb-1.5 flex items-start justify-between gap-2">
            <span className="text-xs font-medium text-slate-400 dark:text-slate-500">
              {a.siteName}
              {a.category && (
                <span className="ml-1.5 text-slate-300 dark:text-slate-600">
                  · {a.category}
                </span>
              )}
            </span>
            {a.qualityScore != null && (
              <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-950/50 dark:text-amber-400">
                <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                {a.qualityScore.toFixed(1)}
              </span>
            )}
          </div>

          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors line-clamp-2">
            {a.title}
          </h3>

          {a.summary && (
            <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400 line-clamp-2 leading-relaxed">
              {a.summary}
            </p>
          )}
        </Link>
      ))}
    </div>
  );
}
