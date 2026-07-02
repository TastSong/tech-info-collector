"use client";

import { useState } from "react";
import Link from "next/link";

interface ArticleItem {
  id: number;
  title: string | null;
  fetchedAt: string | Date | null;
  publishedAt: string | Date | null;
  siteName: string | null;
}

/**
 * Feed 文章卡片：点击标题跳转详情，右侧"已阅读"按钮就地隐藏。
 */
export function FeedCard({ article }: { article: ArticleItem }) {
  const [dismissed, setDismissed] = useState(false);

  async function markRead(e: React.MouseEvent) {
    e.preventDefault(); // 不触发 Link 跳转
    try {
      await fetch(`/api/articles/${article.id}/view`, { method: "POST" });
    } catch {
      // 静默
    }
    setDismissed(true);
  }

  if (dismissed) return null;

  return (
    <div className="group flex items-center rounded-xl border border-slate-200 bg-white p-4 hover:border-indigo-300 hover:shadow-sm transition-all">
      <Link
        href={`/articles/${article.id}?from=feed`}
        className="flex-1 min-w-0"
      >
        <div className="font-medium text-slate-900 group-hover:text-indigo-600 transition-colors line-clamp-1">
          {article.title || "(无标题)"}
        </div>
        <div className="mt-1 flex items-center gap-2 text-xs text-slate-400">
          <span>{article.siteName}</span>
          <span>·</span>
          <span>
            {article.publishedAt
              ? new Date(article.publishedAt).toLocaleDateString("zh-CN")
              : article.fetchedAt
              ? new Date(article.fetchedAt).toLocaleDateString("zh-CN")
              : "-"}
          </span>
        </div>
      </Link>
      <button
        onClick={markRead}
        className="ml-3 shrink-0 rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-400 hover:border-slate-300 hover:text-slate-600 hover:bg-slate-50 transition-colors"
      >
        已阅读
      </button>
    </div>
  );
}
