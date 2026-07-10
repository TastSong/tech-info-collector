"use client";

import { useState, useMemo } from "react";
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
}

interface DateBucket {
  key: string;
  label: string;
  sort: number;
}

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
  articles: ArticleItem[];
}

export function FeedList({ articles }: Props) {
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [siteFilter, setSiteFilter] = useState("");

  // 提取可用选项（去重排序）
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

  // 客户端过滤
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return articles.filter((a) => {
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
  }, [articles, search, categoryFilter, siteFilter]);

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

  const anyFilterActive = search.trim() !== "" || categoryFilter !== "" || siteFilter !== "";

  function clearFilters() {
    setSearch("");
    setCategoryFilter("");
    setSiteFilter("");
  }

  const totalCategories = new Set(filtered.map((r) => r.category ?? "未分类")).size;

  return (
    <>
      {/* 搜索/筛选栏 */}
      <div className="mb-6 rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-end gap-3">
          {/* 关键词搜索 */}
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

          {/* 分类筛选 */}
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

          {/* 站点筛选 */}
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

          {/* 清除按钮 */}
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

      {/* 统计行 */}
      <div className="mb-4 flex items-center gap-2 text-sm text-slate-500">
        {anyFilterActive ? (
          <>
            筛选结果 · {filtered.length} 篇 · {totalCategories} 个分类
          </>
        ) : (
          <>
            近 15 天未读 · {filtered.length} 篇 · {totalCategories} 个分类
          </>
        )}
      </div>

      {/* 文章列表 */}
      {!bucketInfos.length ? (
        <div className="rounded-xl border border-slate-200 bg-white p-12 text-center text-slate-400">
          {anyFilterActive ? "没有匹配的文章" : "暂无新资讯 ✓"}
        </div>
      ) : (
        <div className="space-y-10">
          {bucketInfos.map((bucket) => (
            <section key={bucket.key}>
              <h2 className="mb-4 flex items-center gap-2 text-base font-bold text-slate-800">
                {bucket.label}
                <span className="text-xs font-normal text-slate-400">
                  ({bucket.categories.reduce((sum, c) => sum + c.articles.length, 0)} 篇)
                </span>
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
                        <FeedCard key={a.id} article={a} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
