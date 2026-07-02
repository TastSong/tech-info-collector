"use client";

import { useEffect, useState, useCallback } from "react";

interface RunLog {
  id: number;
  siteId: number | null;
  status: string;
  fetched: number;
  skipped: number;
  updated: number;
  errorCount: number;
  startedAt: string | null;
  endedAt: string | null;
  message: string | null;
}

interface Props {
  initialLogs: RunLog[];
  siteNames: Record<number, string>;
}

/** 运行日志表格，每 3s 轮询自动更新。 */
export function RunsTable({ initialLogs, siteNames }: Props) {
  const [logs, setLogs] = useState<RunLog[]>(initialLogs);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  const poll = useCallback(async () => {
    try {
      const res = await fetch("/api/runs/active");
      if (!res.ok) return;
      const data = await res.json();
      // merge: running + recent overrides for in-progress updates
      const merged = new Map<number, RunLog>();
      for (const l of logs) merged.set(l.id, l);
      // update running ones in-place
      for (const r of data.running) merged.set(r.id, r);
      // add recent that aren't yet in list
      for (const r of data.recent) {
        if (!merged.has(r.id)) merged.set(r.id, r);
      }
      const sorted = [...merged.values()].sort((a, b) => {
        const ta = a.startedAt ? new Date(a.startedAt).getTime() : 0;
        const tb = b.startedAt ? new Date(b.startedAt).getTime() : 0;
        return tb - ta;
      });
      setLogs(sorted);
      setLastRefresh(new Date());
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    const t = setInterval(poll, 3000);
    return () => clearInterval(t);
  }, [poll]);

  const runningCount = logs.filter((l) => l.status === "running").length;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs text-slate-400">
          自动刷新中 · {lastRefresh.toLocaleTimeString("zh-CN")}
          {runningCount > 0 && (
            <span className="ml-2 inline-flex items-center gap-1 text-indigo-600">
              <span className="h-2 w-2 rounded-full bg-indigo-500 animate-pulse" />
              {runningCount} 项进行中
            </span>
          )}
        </p>
      </div>
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">开始时间</th>
              <th className="px-4 py-3">站点</th>
              <th className="px-4 py-3">新采</th>
              <th className="px-4 py-3">更新</th>
              <th className="px-4 py-3">跳过</th>
              <th className="px-4 py-3">错误</th>
              <th className="px-4 py-3">状态</th>
              <th className="px-4 py-3">说明</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {logs.map((r) => (
              <tr
                key={r.id}
                className={`hover:bg-slate-50 ${
                  r.status === "running" ? "bg-indigo-50/50" : ""
                }`}
              >
                <td className="px-4 py-3 text-slate-500">
                  {r.startedAt
                    ? new Date(r.startedAt).toLocaleString("zh-CN")
                    : "-"}
                </td>
                <td className="px-4 py-3 font-medium">
                  {siteNames[r.siteId ?? 0] ?? `#${r.siteId}`}
                </td>
                <td className="px-4 py-3 text-emerald-600">{r.fetched}</td>
                <td className="px-4 py-3 text-indigo-600">{r.updated > 0 ? r.updated : "-"}</td>
                <td className="px-4 py-3 text-slate-400">{r.skipped}</td>
                <td className="px-4 py-3 text-red-500">
                  {r.errorCount > 0 ? r.errorCount : "-"}
                </td>
                <td className="px-4 py-3">
                  {r.status === "success"
                    ? <span className="text-xs font-medium text-emerald-600">成功</span>
                    : r.status === "partial"
                    ? <span className="text-xs font-medium text-amber-600">部分</span>
                    : r.status === "error"
                    ? <span className="text-xs font-medium text-red-600">失败</span>
                    : r.status === "running"
                    ? <span className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600">
                        <span className="h-1.5 w-1.5 rounded-full bg-indigo-500 animate-pulse" />
                        运行中
                      </span>
                    : <span className="text-xs text-slate-400">{r.status}</span>}
                </td>
                <td className="px-4 py-3 max-w-[200px] truncate text-xs text-slate-400">
                  {r.message ?? "-"}
                </td>
              </tr>
            ))}
            {!logs.length ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-slate-400">
                  暂无运行记录
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
