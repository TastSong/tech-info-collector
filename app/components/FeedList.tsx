"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { FeedCard } from "./FeedCard";
import { parseTags } from "@/src/lib/parse-tags";
import { Calendar, Search, Filter, Star, X, Inbox, SearchX, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, ChevronDown, Loader2 } from "lucide-react";
import { useToast } from "./Toast";

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

  if (diffDays === 0) return { key: "today", label: "今天", sort: 0 };
  if (diffDays === 1) return { key: "yesterday", label: "昨天", sort: 1 };

  const dayOfWeek = todayDate.getDay();
  const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const mondayDate = new Date(todayDate);
  mondayDate.setDate(todayDate.getDate() - daysSinceMonday);

  if (articleDate >= mondayDate) {
    return { key: "thisWeek", label: "本周", sort: 2 };
  }
  return { key: "earlier", label: "更早", sort: 3 };
}

interface Props {
  initialArticles: ArticleItem[];
  initialTotal: number;
  initialPage: number;
  initialSavedCount: number;
}

export function FeedList({ initialArticles, initialTotal, initialPage, initialSavedCount }: Props) {
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [siteFilter, setSiteFilter] = useState("");
  const [savedOnly, setSavedOnly] = useState(false);
  const [dismissedIds, setDismissedIds] = useState<Set<number>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<string>("");
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());

  // 防抖搜索
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(debounceRef.current);
  }, [search]);

  // 分页
  const [articles, setArticles] = useState<ArticleItem[]>(initialArticles);
  const [page, setPage] = useState(initialPage);
  const [total, setTotal] = useState(initialTotal);
  const [loadingPage, setLoadingPage] = useState(false);
  const [savedCount, setSavedCount] = useState(initialSavedCount);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // 收藏状态同步
  const handleToggleSaved = useCallback((id: number, saved: boolean) => {
    if (savedOnly && !saved) {
      setArticles((prev) => prev.filter((a) => a.id !== id));
      setTotal((prev) => prev - 1);
    } else {
      setArticles((prev) =>
        prev.map((a) =>
          a.id === id ? { ...a, savedAt: saved ? new Date() : null } : a,
        ),
      );
    }
    setSavedCount((prev) => prev + (saved ? 1 : -1));
  }, []);

  // 客户端过滤（排除已 dismiss 的文章）
  const filtered = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    return articles.filter((a) => {
      if (dismissedIds.has(a.id)) return false;
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
  }, [articles, debouncedSearch, categoryFilter, siteFilter, dismissedIds]);

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

  // 跳转分页
  const goPage = useCallback(async (target: number) => {
    if (target < 1 || target > totalPages || target === page) return;
    setLoadingPage(true);
    try {
      const savedParam = savedOnly ? "&saved=1" : "";
      const res = await fetch(`/api/feed?page=${target}&pageSize=${PAGE_SIZE}${savedParam}`);
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
  }, [page, totalPages, savedOnly]);

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
      toast.success(`已标记 ${ids.length} 篇为已读`);
    } catch {
      setDismissedIds((prev) => {
        const next = new Set(prev);
        for (const id of ids) next.delete(id);
        return next;
      });
      toast.error("标记失败，请重试");
    } finally {
      setBulkLoading(false);
    }
  }, [toast]);

  const markAllRead = useCallback(async () => {
    const ids = filtered.map((a) => a.id);
    // 分批标记，每 10 条一批
    const BATCH = 10;
    setBulkLoading(true);
    let done = 0;
    setDismissedIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      return next;
    });
    try {
      for (let i = 0; i < ids.length; i += BATCH) {
        const batch = ids.slice(i, i + BATCH);
        await fetch("/api/articles/view-batch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: batch }),
        });
        done += batch.length;
        setBulkProgress(`${done}/${ids.length}`);
      }
      toast.success(`已标记 ${ids.length} 篇为已读`);
      // 刷新页面拉取新文章
      setLoadingPage(true);
      try {
        const savedParam = savedOnly ? "&saved=1" : "";
        const res = await fetch(`/api/feed?page=1&pageSize=${PAGE_SIZE}${savedParam}`);
        if (res.ok) {
          const data = await res.json();
          setArticles(((data.articles ?? []) as ArticleRaw[]).map(fromRaw));
          setPage(1);
          setTotal(data.total);
          setDismissedIds(new Set());
        }
      } catch {
        // silent
      }
    } catch {
      setDismissedIds((prev) => {
        const next = new Set(prev);
        for (const id of ids) next.delete(id);
        return next;
      });
      toast.error("标记失败，请重试");
    } finally {
      setBulkLoading(false);
      setBulkProgress("");
    }
  }, [filtered, markBatchRead, savedOnly, toast]);

  const anyFilterActive = search.trim() !== "" || categoryFilter !== "" || siteFilter !== "" || savedOnly;

  function clearFilters() {
    setSearch("");
    setCategoryFilter("");
    setSiteFilter("");
    if (savedOnly) {
      setSavedOnly(false);
      setLoadingPage(true);
      fetch(`/api/feed?page=1&pageSize=${PAGE_SIZE}`)
        .then((res) => res.json())
        .then((data) => {
          setArticles(((data.articles ?? []) as ArticleRaw[]).map(fromRaw));
          setPage(1);
          setTotal(data.total);
          setDismissedIds(new Set());
        })
        .finally(() => setLoadingPage(false));
    }
  }

  const totalDisplayed = total;
  const totalCategories = new Set(filtered.map((r) => r.category ?? "未分类")).size;

  // 为文章分配全局递增 index（用于 animation-delay）
  let animCounter = 0;

  function toggleCategory(catKey: string) {
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(catKey)) next.delete(catKey);
      else next.add(catKey);
      return next;
    });
  }

  return (
    <>
      {/* 搜索/筛选栏 */}
      <div className="mb-6 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
              关键词
            </label>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索标题、摘要、站点…"
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:placeholder-slate-500 dark:focus:border-indigo-500 pl-9 pr-3 py-2 text-sm text-slate-700 placeholder-slate-400 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
              />
            </div>
          </div>

          <div className="min-w-[140px]">
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
              分类
            </label>
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:placeholder-slate-500 dark:focus:border-indigo-500 px-3 py-2 text-sm text-slate-700 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
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
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
              站点
            </label>
            <select
              value={siteFilter}
              onChange={(e) => setSiteFilter(e.target.value)}
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:placeholder-slate-500 dark:focus:border-indigo-500 px-3 py-2 text-sm text-slate-700 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
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
            onClick={async () => {
              const next = !savedOnly;
              setSavedOnly(next);
              setLoadingPage(true);
              try {
                const savedParam = next ? "&saved=1" : "";
                const res = await fetch(`/api/feed?page=1&pageSize=${PAGE_SIZE}${savedParam}`);
                if (!res.ok) return;
                const data = await res.json();
                setArticles(((data.articles ?? []) as ArticleRaw[]).map(fromRaw));
                setPage(1);
                setTotal(data.total);
                setSavedCount(data.savedOnly ? data.total : initialSavedCount);
                setDismissedIds(new Set());
              } catch {
                setSavedOnly(!next);
              } finally {
                setLoadingPage(false);
              }
            }}
            className={`shrink-0 inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
              savedOnly
                ? "border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 hover:bg-amber-100"
                : "border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:border-slate-300 hover:text-slate-700 dark:hover:bg-slate-800 hover:bg-slate-50"
            }`}
          >
            <Star className={`h-3.5 w-3.5 ${savedOnly ? "fill-amber-400 text-amber-400" : ""}`} />
            收藏 {savedCount > 0 && `(${savedCount})`}
          </button>

          {anyFilterActive && (
            <button
              onClick={clearFilters}
              className="shrink-0 inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-xs text-slate-500 dark:text-slate-400 hover:border-slate-300 hover:text-slate-700 dark:hover:bg-slate-800 hover:bg-slate-50 transition-colors"
            >
              <X className="h-3.5 w-3.5" />
              清除筛选
            </button>
          )}
        </div>
      </div>

      {/* 统计行 + 全部已读 + 分页信息 */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm text-slate-500 dark:text-slate-400">
          {savedOnly ? (
            <span className="inline-flex items-center gap-1"><Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" /> 收藏文章 · {totalDisplayed} 篇</span>
          ) : anyFilterActive ? (
            <>筛选结果 · {filtered.length} 篇（共 {totalDisplayed}）</>
          ) : (
            <>近 15 天未读 · {totalDisplayed} 篇 · {totalCategories} 个分类</>
          )}
        </div>
        <div className="flex items-center gap-3">
          {filtered.length > 0 && !savedOnly && (
            <button
              onClick={markAllRead}
              disabled={bulkLoading}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-500 dark:text-slate-400 hover:border-slate-300 hover:text-slate-700 dark:hover:bg-slate-800 hover:bg-slate-50 disabled:opacity-40 transition-colors"
            >
              {bulkLoading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : null}
              {bulkLoading ? (bulkProgress || "处理中…") : `全部已读 (${filtered.length})`}
            </button>
          )}
          <span className="text-xs text-slate-400 dark:text-slate-500">
            第 {page} / {totalPages} 页
          </span>
        </div>
      </div>

      {/* 文章列表 */}
      {!bucketInfos.length ? (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-12 text-center">
          {anyFilterActive ? (
            <div className="flex flex-col items-center gap-3">
              <SearchX className="h-12 w-12 text-slate-200 dark:text-slate-700" />
              <p className="text-slate-400 dark:text-slate-500">没有匹配的文章</p>
              <p className="text-xs text-slate-300 dark:text-slate-500">试试调整筛选条件</p>
              <button onClick={clearFilters} className="mt-1 inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs text-slate-500 dark:text-slate-400 hover:border-slate-300 dark:hover:bg-slate-800 transition-colors">
                <X className="h-3.5 w-3.5" /> 清除筛选
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3">
              <Inbox className="h-12 w-12 text-slate-200 dark:text-slate-700" />
              <p className="text-slate-400 dark:text-slate-500 font-medium">暂无新资讯 ✓</p>
              <p className="text-xs text-slate-300 dark:text-slate-500">所有文章已读完，干得漂亮 🎉</p>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-10">
          {bucketInfos.map((bucket) => {
            const bucketTotal = bucket.categories.reduce(
              (sum, c) => sum + c.articles.length, 0,
            );

            return (
              <section key={bucket.key}>
                <h2 className="mb-4 flex items-center gap-2 text-base font-bold text-slate-800 dark:text-slate-200">
                  <Calendar className="h-4 w-4 text-indigo-400" />
                  {bucket.label}
                  <span className="text-xs font-normal text-slate-400 dark:text-slate-500">
                    ({bucketTotal} 篇)
                  </span>
                </h2>

                <div className="space-y-6">
                  {bucket.categories.map((catGroup) => {
                    const catKey = `${bucket.key}::${catGroup.category}`;
                    const isCollapsed = collapsedCategories.has(catKey);

                    return (
                    <div key={catGroup.category}>
                      <h3
                        className="mb-2 flex cursor-pointer select-none items-center gap-2 text-sm font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 transition-colors"
                        onClick={() => toggleCategory(catKey)}
                      >
                        <ChevronDown
                          className={`h-3.5 w-3.5 text-slate-400 transition-transform duration-200 ${
                            isCollapsed ? "-rotate-90" : ""
                          }`}
                        />
                        <span className="inline-block h-1.5 w-1.5 rounded-full bg-indigo-400" />
                        {catGroup.category}
                        <span className="text-xs font-normal text-slate-400 dark:text-slate-500">
                          ({catGroup.articles.length})
                        </span>
                      </h3>
                      <div
                        className={`overflow-hidden transition-all duration-300 ${
                          isCollapsed ? "max-h-0 opacity-0" : "max-h-[5000px] opacity-100"
                        }`}
                      >
                        <div className="space-y-2 pb-2">
                          {catGroup.articles.map((a) => {
                            const idx = animCounter++;
                            return (
                              <FeedCard
                                key={a.id}
                                article={{
                                  ...a,
                                  onToggleSaved: handleToggleSaved,
                                  animIndex: isCollapsed ? undefined : idx,
                                }}
                              />
                            );
                          })}
                        </div>
                      </div>
                    </div>
                    );
                  })}
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
            className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30 transition-colors cursor-pointer"
          >
            <ChevronsLeft className="h-3.5 w-3.5" />
            首页
          </button>
          <button
            onClick={() => goPage(page - 1)}
            disabled={page <= 1 || loadingPage}
            className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30 transition-colors cursor-pointer"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
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
                    : "text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                }`}
              >
                {p}
              </button>
            ));
          })()}

          <button
            onClick={() => goPage(page + 1)}
            disabled={page >= totalPages || loadingPage}
            className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30 transition-colors cursor-pointer"
          >
            下一页
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => goPage(totalPages)}
            disabled={page >= totalPages || loadingPage}
            className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30 transition-colors cursor-pointer"
          >
            末页
            <ChevronsRight className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {loadingPage && (
        <p className="mt-2 text-center text-xs text-slate-400 dark:text-slate-500">加载中…</p>
      )}
    </>
  );
}
