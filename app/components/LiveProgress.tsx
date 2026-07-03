"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

interface RunItem {
  id: number;
  siteId: number | null;
  siteName: string | null;
  status: string;
  fetched: number;
  skipped: number;
  updated: number;
  errorCount: number;
  startedAt: string | null;
  endedAt: string | null;
  message: string | null;
}

interface SessionInfo {
  id: number;
  status: string;
  siteCount: number;
  completedCount: number;
}

interface ProgressData {
  running: RunItem[];
  recent: RunItem[];
  session: SessionInfo | null;
}

/** 轮询 /api/runs/active，每 3s 刷新一次进度。 */
export function LiveProgress() {
  const [data, setData] = useState<ProgressData | null>(null);
  const [error, setError] = useState("");

  const poll = useCallback(async () => {
    try {
      const res = await fetch("/api/runs/active");
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json();
      setData(json);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    poll();
    const t = setInterval(poll, 3000);
    return () => clearInterval(t);
  }, [poll]);

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-600">
        进度拉取失败: {error}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-400">
        加载中...
      </div>
    );
  }

  const { running, recent, session } = data;

  if (!running.length && !recent.length) return null;

  // 计算 running 汇总
  const runningFetched = running.reduce((s, r) => s + r.fetched, 0);
  const runningUpdated = running.reduce((s, r) => s + r.updated, 0);
  const runningErrors = running.reduce((s, r) => s + r.errorCount, 0);
  const sessionDone = session?.completedCount ?? 0;

  return (
    <div className="space-y-4">
      {/* Running */}
      {running.length > 0 && (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="inline-flex h-3 w-3 rounded-full bg-indigo-500 animate-pulse" />
            <span className="text-sm font-semibold text-indigo-700">
              采集进行中
              {session ? (
                <span> ({sessionDone}/{session.siteCount} 站点)</span>
              ) : (
                <span> ({running.length} 个站点)</span>
              )}
            </span>
            {runningFetched > 0 && (
              <span className="text-xs text-indigo-500">
                已采 {runningFetched + runningUpdated} 篇
              </span>
            )}
            {runningErrors > 0 && (
              <span className="text-xs text-red-500">
                {runningErrors} 个错误
              </span>
            )}
          </div>
          {/* 进度条 */}
          {session && session.siteCount > 0 && (
            <div className="mb-3 h-1.5 rounded-full bg-indigo-200 overflow-hidden">
              <div
                className="h-full rounded-full bg-indigo-500 transition-all duration-500"
                style={{
                  width: `${Math.round((sessionDone / session.siteCount) * 100)}%`,
                }}
              />
            </div>
          )}
          <div className="space-y-1 max-h-64 overflow-y-auto">
            {running.map((r) => (
              <div
                key={r.id}
                className="flex items-center justify-between rounded bg-white/60 px-3 py-1.5 text-xs"
              >
                <span className="text-slate-700 font-medium">
                  {r.siteName ?? `站点 #${r.siteId ?? "?"}`}
                </span>
                <span className="text-slate-500">
                  {r.fetched > 0 && (
                    <span className="text-emerald-600 mr-2">新 {r.fetched}</span>
                  )}
                  {r.updated > 0 && (
                    <span className="text-indigo-600 mr-2">变 {r.updated}</span>
                  )}
                  {r.errorCount > 0 && (
                    <span className="text-red-500 mr-2">错误 {r.errorCount}</span>
                  )}
                  {r.startedAt
                    ? new Date(r.startedAt).toLocaleTimeString("zh-CN")
                    : "-"}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <Link
              href="/runs"
              className="text-xs text-indigo-600 hover:text-indigo-800"
            >
              查看全部运行日志 →
            </Link>
          </div>
        </div>
      )}

      {/* Recently finished (last batch) */}
      {!running.length && recent.length > 0 && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-emerald-700">
            <span>✓ 最近一轮采集完成</span>
            <span className="text-xs font-normal text-emerald-500">
              {recent.length} 个站点 ·{" "}
              {recent.reduce((s, r) => s + r.fetched, 0)} 篇新文章 ·{" "}
              {recent.reduce((s, r) => s + r.updated, 0)} 篇更新
            </span>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            {recent.slice(0, 10).map((r) => (
              <span
                key={r.id}
                className="inline-flex items-center rounded bg-emerald-100 px-2 py-1 text-emerald-700"
              >
                {r.siteName ?? `站点#${r.siteId ?? "?"}`}: 新+{r.fetched} 变{r.updated > 0 ? `+${r.updated}` : 0}
              </span>
            ))}
            {recent.length > 10 && (
              <span className="text-slate-400">...等 {recent.length} 条</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
