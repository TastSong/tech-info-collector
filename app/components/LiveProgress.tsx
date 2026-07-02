"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

interface RunItem {
  id: number;
  siteId: number | null;
  status: string;
  fetched: number;
  skipped: number;
  errorCount: number;
  startedAt: string | null;
  endedAt: string | null;
  message: string | null;
}

interface ProgressData {
  running: RunItem[];
  recent: RunItem[];
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

  const { running, recent } = data;

  if (!running.length && !recent.length) return null;

  return (
    <div className="space-y-4">
      {/* Running */}
      {running.length > 0 && (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="inline-flex h-3 w-3 rounded-full bg-indigo-500 animate-pulse" />
            <span className="text-sm font-semibold text-indigo-700">
              采集进行中 ({running.length} 个站点)
            </span>
          </div>
          <div className="space-y-1 max-h-64 overflow-y-auto">
            {running.map((r) => (
              <div
                key={r.id}
                className="flex items-center justify-between rounded bg-white/60 px-3 py-1.5 text-xs"
              >
                <span className="text-slate-700 font-medium">
                  站点 #{r.siteId ?? "?"}
                </span>
                <span className="text-slate-500">
                  {r.fetched > 0 && (
                    <span className="text-emerald-600 mr-2">已抓 {r.fetched}</span>
                  )}
                  {r.errorCount > 0 && (
                    <span className="text-red-500 mr-2">错误 {r.errorCount}</span>
                  )}
                  {new Date(r.startedAt!).toLocaleTimeString("zh-CN")}
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
          <div className="mb-2 text-sm font-semibold text-emerald-700">
            ✓ 最近一轮采集完成
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            {recent.slice(0, 10).map((r) => (
              <span
                key={r.id}
                className="inline-flex items-center rounded bg-emerald-100 px-2 py-1 text-emerald-700"
              >
                站点#{r.siteId ?? "?"}: +{r.fetched}
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
