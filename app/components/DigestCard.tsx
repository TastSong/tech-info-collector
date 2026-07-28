"use client";

import { useState, useEffect } from "react";
import { Newspaper, ChevronDown, Loader2 } from "lucide-react";

interface DigestData {
  date: string;
  content: string;
  articleCount: number;
  createdAt: number;
}

/**
 * 每日 AI 摘要卡片。
 *
 * 页面加载时从 /api/feed/digest 拉取最新摘要并展示 Markdown。
 * 默认展开；无摘要时隐藏。
 */
export function DigestCard() {
  const [digest, setDigest] = useState<DigestData | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    fetch("/api/feed/digest")
      .then((res) => res.json())
      .then((data) => setDigest(data.digest ?? null))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return null; // 加载中不显示（不打断用户翻页）
  if (!digest) return null; // 无摘要时完全折叠

  const dateLabel = digest.date;

  return (
    <div className="mb-6 rounded-xl border border-indigo-200 bg-gradient-to-br from-indigo-50/70 to-white p-5 dark:border-indigo-900/50 dark:from-indigo-950/30 dark:to-slate-900">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="mb-3 flex w-full items-center gap-2 text-left"
      >
        <Newspaper className="h-5 w-5 text-indigo-500" />
        <h2 className="text-sm font-bold text-indigo-700 dark:text-indigo-300">
          📰 每日 AI 摘要 · {dateLabel}
        </h2>
        <span className="text-xs text-indigo-400 dark:text-indigo-500">
          {digest.articleCount} 篇覆盖
        </span>
        <ChevronDown
          className={`ml-auto h-4 w-4 text-indigo-400 transition-transform duration-200 ${
            open ? "" : "-rotate-90"
          }`}
        />
      </button>

      <div
        className={`overflow-hidden transition-all duration-300 ${
          open ? "max-h-[2000px] opacity-100" : "max-h-0 opacity-0"
        }`}
      >
        <div className="prose prose-sm max-w-none text-slate-700 dark:text-slate-300 dark:prose-invert prose-headings:text-indigo-700 dark:prose-headings:text-indigo-300 prose-strong:text-slate-800 dark:prose-strong:text-slate-200 prose-a:text-indigo-600">
          {/* eslint-disable-next-line react/no-danger */}
          <div dangerouslySetInnerHTML={{ __html: renderMarkdown(digest.content) }} />
        </div>
      </div>
    </div>
  );
}

/** 简易 Markdown → HTML 渲染（只处理 digest 输出格式，无需完整编译器） */
function renderMarkdown(md: string): string {
  return md
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/^- (.+)$/gm, "<li>$1</li>")
    .replace(/(<li>.*<\/li>\n?)+/g, "<ul>$&</ul>")
    .replace(/---/g, "<hr />")
    .replace(/\n\n/g, "</p><p>")
    .replace(/^(?!<[hulip/])/gm, "<p>$&")
    .replace(/\n/g, "<br />");
}
