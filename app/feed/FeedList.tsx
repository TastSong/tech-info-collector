"use client";

import { useState, useMemo, useCallback } from "react";
import { FeedCard } from "../components/FeedCard";

export interface ArticleItem {
  id: number;
  title: string | null;
  headline: string | null;
  fetchedAt: Date;
  publishedAt: Date | null;
  siteId: number;
  siteName: string;
  category: string | null;
  summary: string | null;
  tags: string[];
  qualityScore: number | null;
  savedAt: string | Date | null;
}

/** API 返回的原始格式（时间戳为 Unix 秒数） */
interface ArticleRaw {
  id: number;
  title: string | null;
  headline: string | null;
  fetchedAt: number;
  publishedAt: number | null;
  siteId: number;
  siteName: string;
  category: string | null;
  summary: string | null;
  tags: string | null;
  qualityScore: number | null;
  savedAt: number | null;
}

function parseTags(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function fromRaw(r: ArticleRaw): ArticleItem {
  return {
    ...r,
    fetchedAt: new Date(r.fetchedAt * 1000),
    publishedAt: r.publishedAt ? new Date(r.publishedAt * 1000) : null,
    tags: parseTags(r.tags),
    savedAt: r.savedAt ? new Date(r.savedAt * 1000) : null,
  };
}

interface DateBucket {
  key: string;
  label: string;
  sort: number;
}

const PAGE_SIZE = 30;

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

  if (diffDays === 0) return { key: "today", label: "📅 今天", sort: 0 };
  if (diffDays === 1) return { key: "yesterday", label: "📅 昨天", sort: 1 };

  const dayOfWeek = todayDate.getDay();
  const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const mondayDate = new Date(todayDate);
  mondayDate.setDate(todayDate.getDate() - daysSinceMonday);

  if (articleDate >= mondayDate) {
    return { key: "thisWeek", label: "📅 本周", sort: 2 };
  }
  return { key: "earlier", label: "📅 更早", sort: 3 };
}

interface Props {
  initialArticles: ArticleItem[];
  initialTotal: number;
  initialPage: number;
}

export function FeedList({ initialArticles, initialTotal, initialPage }: Props) {
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [siteFilter, setSiteFilter] = useState("");
  const [savedOnly, setSavedOnly] = useState(false);
  const [dismissedIds, setDismissedIds] = useState<Set<number>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);

  // 分页
  const [articles, setArticles] = useState<ArticleItem[]>(initialArticles);
  const [page, setPage] = useState(initialPage);
  const [total, setTotal] = useState(initialTotal);
  const [loadingPage, setLoadingPage] = useState(false);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // 收藏状态同步：当子组件切换收藏时，同步更新 articles 列表
  const handleToggleSaved = useCallback((id: number, saved: boolean) => {
    setArticles((prev) =>
      prev.map((a) =>
        a.id === id ? { ...a, savedAt: saved ? new Date() : null } : a,
      ),
    );
  }, []);

  // 客户端过滤（排除已 dismiss 的文章）
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return articles.filter((a) => {
      if (dismissedIds.has(a.id)) return false;
      if (savedOnly && a.savedAt == null) return false;
      if (q) {
        const haystack = [a.title, a.headline, a.summary, a.siteName]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      if (categoryFilter) {
        const cat = a.category ?? "未分类";
        if (cat !== categoryFilter) return false;
      }
      if (siteFilter && a.siteName !== siteFilter) return false;
      return true;
    });
  }, [articles, search, categoryFilter, siteFilter, dismissedIds, savedOnly]);

  // 提取可用选项
  const { categories, sites } = useMemo(() => {
    const cats = new Set<string>();
    const sts = new Set<string>();
    for (const a of articles) {
      cats.add(a.category ?? "未分类");
      sts.add(a.siteName);
    }
    return {
      categories: Array.from(cats).sort((a, b) => a.localeCompare(b, "zh")),
      sites: Array.from(sts).sort((a, b) => a.localeCompare(b, "zh")),
    };
  }, [articles]);

  const savedCount = useMemo(
    () => articles.filter((a) => a.savedAt != null && !dismissedIds.has(a.id)).length,
    [articles, dismissedIds],
  );

  // 双层分组：日期桶 → category → articles
  const bucketInfos = useMemo(() => {
    const dateGroups = new Map<string, Map<string, ArticleItem[]>>();
    const catOrderInDate = new Map<string, string[]>();

    for (const r of filtered) {
      const effectiveDate = r.publishedAt ?? r.fetchedAt;
      const bucket = getDateBucket(effectiveDate);

      if (!dateGroups.has(bucket.key)) {
        dateGroups.set(bucket.key, new Map());
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

    return Array.from(dateGroups.entries())
      .sort((a, b) => {
        const sampleA = a[1].values().next().value?.[0];
        const sampleB = b[1].values().next().value?.[0];
        const dateA = sampleA?.publishedAt ?? sampleA?.fetchedAt ?? new Date(0);
        const dateB = sampleB?.publishedAt ?? sampleB?.fetchedAt ?? new Date(0);
        return getDateBucket(dateA).sort - getDateBucket(dateB).sort;
      })
      .map(([bucketKey, catMap]) => {
        const catOrder = catOrderInDate.get(bucketKey) ?? [];
        const sortedCats = catOrder
          .filter((cat) => catMap.has(cat))
          .map((cat) => ({ category: cat, articles: catMap.get(cat)! }));
        const sample = sortedCats[0]?.articles[0];
        const sampleDate = sample?.publishedAt ?? sample?.fetchedAt ?? new Date();
        return { label: getDateBucket(sampleDate).label, key: bucketKey, categories: sortedCats };
      });
  }, [filtered]);

  function bucketIds(bucketKey: string): number[] {
    const info = bucketInfos.find((b) => b.key === bucketKey);
    if (!info) return [];
    return info.categories.flatMap((c) => c.articles.map((a) => a.id));
  }

  // 跳转分页
  const goPage = useCallback(async (target: number) => {
    if (target < 1 || target > totalPages || target === page) return;
    setLoadingPage(true);
    try {
      const res = await fetch(`/api/feed?page=${target}&pageSize=${PAGE_SIZE}`);
      if (!res.ok) return;
      const data = await res.json();
      setArticles(((data.articles ?? []) as ArticleRaw[]).map(fromRaw));
      setPage(data.page);
      setTotal(data.total);
      setDismissedIds(new Set());
    } catch {
      // silent
    } finally {
      setLoadingPage(false);
    }
  }, [page, totalPages]);

  // 批量标记已读
  const markBatchRead = useCallback(async (ids: number[]) => {
    if (ids.length === 0) return;
    setBulkLoading(true);
    setDismissedIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      return next;
    });
    try {
      await fetch("/api/articles/view-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      setTotal((prev) => prev - ids.length);
    } catch {
      setDismissedIds((prev) => {
        const next = new Set(prev);
        for (const id of ids) next.delete(id);
        return next;
      });
    } finally {
      setBulkLoading(false);
    }
  }, []);

  const markAllRead = useCallback(() => {
    const ids = filtered.map((a) => a.id);
    markBatchRead(ids);
  }, [filtered, markBatchRead]);

  const anyFilterActive = search.trim() !== "" || categoryFilter !== "" || siteFilter !== "" || savedOnly;

  function clearFilters() {
    setSearch("");
    setCategoryFilter("");
    setSiteFilter("");
    setSavedOnly(false);
  }

  const totalDisplayed = total;
  const totalCategories = new Set(filtered.map((r) => r.category ?? "未分类")).size;

  return (
    <>
      {/* 搜索/筛选栏 */}
      <div className="mb-6 rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs font-medium text-slate-500 mb-1">
              关键词
            </label>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索标题、摘要、站点…"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 placeholder-slate-400 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
            />
          </div>

          <div className="min-w-[140px]">
            <label className="block text-xs font-medium text-slate-500 mb-1">
              分类
            </label>
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
            >
              <option value="">全部类别</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div className="min-w-[160px]">
            <label className="block text-xs font-medium text-slate-500 mb-1">
              站点
            </label>
            <select
              value={siteFilter}
              onChange={(e) => setSiteFilter(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
            >
              <option value="">全部站点</option>
              {sites.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          {/* 仅看收藏 */}
          <button
            onClick={() => setSavedOnly((v) => !v)}
            className={`shrink-0 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
              savedOnly
                ? "border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100"
                : "border-slate-200 text-slate-500 hover:border-slate-300 hover:text-slate-700 hover:bg-slate-50"
            }`}
          >
            ★ 收藏 {savedCount > 0 && `(${savedCount})`}
          </button>

          {anyFilterActive && (
            <button
              onClick={clearFilters}
              className="shrink-0 rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-500 hover:border-slate-300 hover:text-slate-700 hover:bg-slate-50 transition-colors"
            >
              清除筛选
            </button>
          )}
        </div>
      </div>

      {/* 统计行 + 全部已读 + 分页信息 */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm text-slate-500">
          {anyFilterActive ? (
            <>筛选结果 · {filtered.length} 篇（共 {totalDisplayed}）</>
          ) : (
            <>近 15 天未读 · {totalDisplayed} 篇 · {totalCategories} 个分类</>
          )}
        </div>
        <div className="flex items-center gap-3">
          {filtered.length > 0 && (
            <button
              onClick={markAllRead}
              disabled={bulkLoading}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-500 hover:border-slate-300 hover:text-slate-700 hover:bg-slate-50 disabled:opacity-40 transition-colors"
            >
              {bulkLoading ? "处理中…" : `全部已读 (${filtered.length})`}
            </button>
          )}
          <span className="text-xs text-slate-400">
            第 {page} / {totalPages} 页
          </span>
        </div>
      </div>

      {/* 文章列表 */}
      {!bucketInfos.length ? (
        <div className="rounded-xl border border-slate-200 bg-white p-12 text-center text-slate-400">
          {anyFilterActive ? "没有匹配的文章" : "暂无新资讯 ✓"}
        </div>
      ) : (
        <div className="space-y-10">
          {bucketInfos.map((bucket) => {
            const bIds = bucketIds(bucket.key);
            const bucketTotal = bIds.length;

            return (
              <section key={bucket.key}>
                <h2 className="mb-4 flex items-center gap-2 text-base font-bold text-slate-800">
                  {bucket.label}
                  <span className="text-xs font-normal text-slate-400">
                    ({bucketTotal} 篇)
                  </span>
                  {bucketTotal > 0 && (
                    <button
                      onClick={() => markBatchRead(bIds)}
                      disabled={bulkLoading}
                      className="ml-1 rounded px-1.5 py-0.5 text-xs text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 disabled:opacity-30 transition-colors"
                    >
                      全部已读
                    </button>
                  )}
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
                          <FeedCard
                            key={a.id}
                            article={{ ...a, onToggleSaved: handleToggleSaved }}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {/* 分页导航 */}
      {totalPages > 1 && (
        <div className="mt-8 flex items-center justify-center gap-2">
          <button
            onClick={() => goPage(1)}
            disabled={page <= 1 || loadingPage}
            className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100 disabled:opacity-30 transition-colors cursor-pointer"
          >
            首页
          </button>
          <button
            onClick={() => goPage(page - 1)}
            disabled={page <= 1 || loadingPage}
            className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100 disabled:opacity-30 transition-colors cursor-pointer"
          >
            上一页
          </button>

          {(() => {
            const buttons: number[] = [];
            const start = Math.max(1, page - 2);
            const end = Math.min(totalPages, page + 2);
            for (let i = start; i <= end; i++) buttons.push(i);
            return buttons.map((p) => (
              <button
                key={p}
                onClick={() => goPage(p)}
                disabled={loadingPage}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                  p === page
                    ? "bg-indigo-600 text-white"
                    : "text-slate-500 hover:bg-slate-100"
                }`}
              >
                {p}
              </button>
            ));
          })()}

          <button
            onClick={() => goPage(page + 1)}
            disabled={page >= totalPages || loadingPage}
            className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100 disabled:opacity-30 transition-colors cursor-pointer"
          >
            下一页
          </button>
          <button
            onClick={() => goPage(totalPages)}
            disabled={page >= totalPages || loadingPage}
            className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100 disabled:opacity-30 transition-colors cursor-pointer"
          >
            末页
          </button>
        </div>
      )}

      {loadingPage && (
        <p className="mt-2 text-center text-xs text-slate-400">加载中…</p>
      )}
    </>
  );
}
