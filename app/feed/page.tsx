import { countFeedArticles, queryFeedArticles } from "@/src/data/feed";
import { FeedList } from "./FeedList";
import type { ArticleItem } from "./FeedList";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 30;

function tryParseTags(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export default async function FeedPage() {
  const total = countFeedArticles();
  const rawRows = queryFeedArticles({ limit: PAGE_SIZE, offset: 0 });

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
    tags: tryParseTags(r.tags),
    qualityScore: r.qualityScore,
  }));

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">资讯流</h1>
      </div>

      <FeedList
        initialArticles={articles}
        initialTotal={total}
        initialPage={1}
      />
    </main>
  );
}
