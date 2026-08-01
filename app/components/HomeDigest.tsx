"use client";

import { useState } from "react";
import { Newspaper, ChevronDown } from "lucide-react";

interface DigestData {
  date: string;
  content: string;
  articleCount: number;
  createdAt: number;
}

/**
 * 首页每日 AI 摘要卡片。
 *
 * 接收服务端传入的 digest 数据直接渲染，无需客户端 fetch。
 * 默认展开，无摘要时显示占位提示。
 */
export function HomeDigest({ digest }: { digest: DigestData | null }) {
  const [open, setOpen] = useState(true);

  if (!digest) {
    return (
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center">
        <Newspaper className="mx-auto h-10 w-10 text-slate-300 dark:text-slate-600 mb-3" />
        <p className="text-slate-500 dark:text-slate-400 font-medium">
          今日 AI 摘要尚未生成
        </p>
        <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
          等待下一次定时分析完成后自动生成，或手动执行分析触发
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-indigo-200 bg-gradient-to-br from-indigo-50/60 to-white p-6 dark:border-indigo-900/50 dark:from-indigo-950/30 dark:to-slate-900">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="mb-4 flex w-full items-center gap-2.5 text-left"
      >
        <Newspaper className="h-6 w-6 text-indigo-500 shrink-0" />
        <h1 className="text-lg font-bold text-indigo-700 dark:text-indigo-300">
          📰 每日 AI 摘要
        </h1>
        <span className="rounded-full bg-indigo-100 px-2.5 py-0.5 text-xs font-medium text-indigo-600 dark:bg-indigo-900/50 dark:text-indigo-400">
          {digest.date}
        </span>
        <span className="text-xs text-indigo-400 dark:text-indigo-500">
          {digest.articleCount} 篇覆盖
        </span>
        <ChevronDown
          className={`ml-auto h-5 w-5 text-indigo-400 transition-transform duration-200 ${
            open ? "" : "-rotate-90"
          }`}
        />
      </button>

      <div
        className={`overflow-hidden transition-all duration-300 ${
          open ? "max-h-[5000px] opacity-100" : "max-h-0 opacity-0"
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

/** 简易 Markdown → HTML 渲染 */
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
