import { countHistoryArticles, queryHistoryArticles } from "@/src/data/feed";
import { HistoryList } from "./HistoryList";
import type { HistoryItem } from "./HistoryList";
import { parseTags } from "@/src/lib/parse-tags";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 30;

export default async function HistoryPage() {
  const total = countHistoryArticles();
  const rawRows = queryHistoryArticles({ limit: PAGE_SIZE, offset: 0 });

  const articles: HistoryItem[] = rawRows.map((r) => ({
    id: r.id,
    title: r.title,
    headline: r.headline,
    fetchedAt: new Date(r.fetchedAt * 1000),
    publishedAt: r.publishedAt ? new Date(r.publishedAt * 1000) : null,
    viewedAt: new Date(r.viewedAt * 1000),
    siteId: r.siteId,
    siteName: r.siteName,
    category: r.category,
    summary: r.summary,
    tags: parseTags(r.tags),
    qualityScore: r.qualityScore,
    savedAt: r.savedAt ? new Date(r.savedAt * 1000) : null,
  }));

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">已读历史</h1>
        <p className="mt-1 text-sm text-slate-500">
          浏览已经阅读过的资讯，按阅读时间倒序排列
        </p>
      </div>

      <HistoryList
        initialArticles={articles}
        initialTotal={total}
        initialPage={1}
      />
    </main>
  );
}
