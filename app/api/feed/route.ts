/**
 * GET /api/feed — 分页查询资讯流文章（去重后，当前用户视角）。
 *
 * Query params:
 *  - page     (default 1)
 *  - pageSize (default 30, max 100)
 *  - saved    (1 = 仅收藏)
 *
 * Response: { articles, total, page, pageSize, totalPages }
 * articles 中的日期字段是 Unix 秒数（客户端自行转为 Date）。
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/src/lib/auth";
import { countFeedArticles, queryFeedArticles, countSavedArticles, querySavedArticles } from "@/src/data/feed";

export const dynamic = "force-dynamic";

const PAGE_SIZE_MAX = 100;
const PAGE_SIZE_DEFAULT = 30;

export async function GET(req: Request) {
  const user = await requireAuth();
  if (user instanceof NextResponse) return user;

  const { searchParams } = new URL(req.url);
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const pageSize = Math.min(
    PAGE_SIZE_MAX,
    Math.max(1, Number(searchParams.get("pageSize")) || PAGE_SIZE_DEFAULT),
  );
  const offset = (page - 1) * pageSize;
  const savedOnly = searchParams.get("saved") === "1";

  const total = savedOnly ? countSavedArticles(user.id) : countFeedArticles(user.id);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const rawRows = savedOnly
    ? querySavedArticles({ limit: pageSize, offset }, user.id)
    : queryFeedArticles({ limit: pageSize, offset }, user.id);

  const articles = rawRows.map((r) => ({
    id: r.id,
    title: r.title,
    headline: r.headline,
    fetchedAt: r.fetchedAt,
    publishedAt: r.publishedAt,
    siteId: r.siteId,
    siteName: r.siteName,
    category: r.category,
    summary: r.summary,
    tags: r.tags,
    qualityScore: r.qualityScore,
    savedAt: r.savedAt,
  }));

  return NextResponse.json({ articles, total, page, pageSize, totalPages, savedOnly });
}
