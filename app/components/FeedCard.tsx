"use client";

import { useState } from "react";
import Link from "next/link";

interface ArticleItem {
  id: number;
  title: string | null;
  headline: string | null;
  fetchedAt: string | Date | null;
  publishedAt: string | Date | null;
  siteName: string | null;
  summary: string | null;
  tags?: string[];
  qualityScore?: number | null;
}

/**
 * Feed 文章卡片：AI 生成标题 + 原文标题 + AI 摘要 + 来源信息，右侧"已阅读"按钮带淡出动画。
 */
export function FeedCard({ article }: { article: ArticleItem }) {
  const [state, setState] = useState<
    "idle" | "loading" | "dismissing" | "dismissed" | "error"
  >("idle");

  async function markRead(e: React.MouseEvent) {
    e.preventDefault();
    if (state !== "idle" && state !== "error") return;
    setState("loading");
    try {
      const res = await fetch(`/api/articles/${article.id}/view`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("mark read failed");
      setState("dismissing");
      // 动画持续 300ms，之后移除 DOM
      setTimeout(() => setState("dismissed"), 300);
    } catch {
      setState("error");
      // 4 秒后错误状态自动恢复
      setTimeout(() => {
        setState((s) => (s === "error" ? "idle" : s));
      }, 4000);
    }
  }

  if (state === "dismissed") return null;

  const displayTitle = article.headline || article.title || "(无标题)";
  const isError = state === "error";
  const isDismissing = state === "dismissing";

  return (
    <div
      className={`group flex items-center rounded-xl border p-4 transition-all duration-300 ease-out ${
        isDismissing
          ? "opacity-0 -translate-y-2 blur-[2px] pointer-events-none"
          : isError
          ? "border-red-200 bg-red-50/30"
          : "border-slate-200 bg-white hover:border-indigo-300 hover:shadow-sm"
      }`}
    >
      <Link
        href={`/articles/${article.id}?from=feed`}
        className="flex-1 min-w-0"
      >
        <div className="font-medium text-slate-900 group-hover:text-indigo-600 transition-colors line-clamp-1">
          {displayTitle}
        </div>
        {article.headline &&
        article.title &&
        article.headline !== article.title ? (
          <p className="text-xs text-slate-400 line-clamp-1 mt-0.5">
            原文：{article.title}
          </p>
        ) : null}
        {article.summary ? (
          <p className="mt-1 text-sm text-slate-500 line-clamp-2">
            {article.summary}
          </p>
        ) : null}

        {/* tags + quality score row */}
        {(article.tags && article.tags.length > 0) || article.qualityScore != null ? (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {article.tags?.map((tag) => (
              <span
                key={tag}
                className="inline-block rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-600"
              >
                {tag}
              </span>
            ))}
            {article.qualityScore != null && (
              <span className="inline-flex items-center gap-0.5 text-[11px] text-amber-600">
                <span className="text-[10px]">★</span>
                {article.qualityScore.toFixed(1)}
              </span>
            )}
          </div>
        ) : null}

        <div className="mt-1 flex items-center gap-2 text-xs text-slate-400">
          <span>{article.siteName}</span>
          <span>·</span>
          <span>
            {article.publishedAt
              ? new Date(article.publishedAt).toLocaleDateString("zh-CN", {
                  timeZone: "Asia/Shanghai",
                })
              : article.fetchedAt
              ? new Date(article.fetchedAt).toLocaleDateString("zh-CN", {
                  timeZone: "Asia/Shanghai",
                })
              : "-"}
          </span>
        </div>
      </Link>
      <button
        onClick={markRead}
        disabled={state === "loading" || isDismissing}
        className={`ml-3 shrink-0 rounded-lg border px-3 py-1.5 text-xs transition-colors ${
          isError
            ? "border-red-300 text-red-600 hover:border-red-400 hover:bg-red-50"
            : "border-slate-200 text-slate-400 hover:border-slate-300 hover:text-slate-600 hover:bg-slate-50"
        } ${state === "loading" ? "opacity-50" : ""}`}
      >
        {state === "loading" ? "…" : isError ? "重试" : "已阅读"}
      </button>
    </div>
  );
}
