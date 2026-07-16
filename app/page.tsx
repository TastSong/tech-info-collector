import { getCurrentUser } from "@/src/lib/auth";
import { countFeedArticles, queryFeedArticles, countSavedArticles } from "@/src/data/feed";
import { FeedList } from "./components/FeedList";
import type { ArticleItem } from "./components/FeedList";
import { parseTags } from "@/src/lib/parse-tags";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 30;

export default async function HomePage() {
  const user = await getCurrentUser();
  if (!user) return null; // middleware 已拦截，此处为安全兜底

  const total = countFeedArticles(user.id);
  const savedCount = countSavedArticles(user.id);
  const rawRows = queryFeedArticles({ limit: PAGE_SIZE, offset: 0 }, user.id);

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
    tags: parseTags(r.tags),
    qualityScore: r.qualityScore,
    savedAt: r.savedAt ? new Date(r.savedAt * 1000) : null,
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
        initialSavedCount={savedCount}
      />
    </main>
  );
}
