"use client";

import { useEffect, useState, useCallback, useRef } from "react";

/* ---------- types ---------- */

interface RunLog {
  id: number;
  siteId: number | null;
  crawlSessionId: number | null;
  status: string;
  fetched: number;
  skipped: number;
  updated: number;
  errorCount: number;
  startedAt: string | null;
  endedAt: string | null;
  message: string | null;
}

interface CrawlSessionInfo {
  id: number;
  startedAt: string | Date | null;
}

interface Props {
  initialLogs: RunLog[];
  siteNames: Record<number, string>;
  sessionMap: Record<number, CrawlSessionInfo>;
  total: number;
}

const PAGE_SIZE = 30;

/* ---------- component ---------- */

export function RunsTable({ initialLogs, siteNames, sessionMap, total: initialTotal }: Props) {
  const [logs, setLogs] = useState<RunLog[]>(initialLogs);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(initialTotal);
  const [loading, setLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const pollingRef = useRef(page === 1);
  pollingRef.current = page === 1;
  const logsRef = useRef(logs);
  logsRef.current = logs;

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  /** 跳转到指定页 */
  const goPage = useCallback(async (target: number) => {
    if (target < 1 || target > totalPages || target === page) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/runs?page=${target}&pageSize=${PAGE_SIZE}`);
      if (!res.ok) return;
      const data = await res.json();
      setLogs(data.logs);
      setPage(data.page);
      setTotal(data.total);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [page, totalPages]);

  /** 轮询：仅在首页时更新 running / recent 状态 */
  const poll = useCallback(async () => {
    if (!pollingRef.current) return;
    try {
      const currentLogs = logsRef.current;
      const res = await fetch("/api/runs/active");
      if (!res.ok) return;
      const data = await res.json();

      // 合并 running + recent 到当前列表
      const merged = new Map<number, RunLog>();
      for (const l of currentLogs) merged.set(l.id, l);
      for (const r of data.running) merged.set(r.id, r);
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

      // 如果新增了已完成的任务，更新 total 计数
      const runningIds = new Set(data.running.map((r: RunLog) => r.id));
      const newCompleted = data.recent.filter(
        (r: RunLog) => !runningIds.has(r.id) && !currentLogs.find((l: RunLog) => l.id === r.id),
      );
      if (newCompleted.length > 0) {
        setTotal((prev) => prev + newCompleted.length);
      }
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    const t = setInterval(poll, 3000);
    return () => clearInterval(t);
  }, [poll]);

  const runningCount = logs.filter((l) => l.status === "running").length;

  /* ---------- render helpers ---------- */

  function statusBadge(status: string) {
    switch (status) {
      case "success":
        return <span className="text-xs font-medium text-emerald-600">成功</span>;
      case "partial":
        return <span className="text-xs font-medium text-amber-600">部分</span>;
      case "error":
        return <span className="text-xs font-medium text-red-600">失败</span>;
      case "running":
        return (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600">
            <span className="h-1.5 w-1.5 rounded-full bg-indigo-500 animate-pulse" />
            运行中
          </span>
        );
      default:
        return <span className="text-xs text-slate-400">{status}</span>;
    }
  }

  /* ---------- render ---------- */

  return (
    <div>
      {/* 状态栏 */}
      <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-slate-400">
          {page === 1 ? (
            <>
              自动刷新中 · {lastRefresh.toLocaleTimeString("zh-CN", { timeZone: "Asia/Shanghai" })}
              {runningCount > 0 && (
                <span className="ml-2 inline-flex items-center gap-1 text-indigo-600">
                  <span className="h-2 w-2 rounded-full bg-indigo-500 animate-pulse" />
                  {runningCount} 项进行中
                </span>
              )}
            </>
          ) : (
            <>共 {total} 条记录</>
          )}
        </p>
        <p className="text-xs text-slate-400">
          第 {page} / {totalPages} 页
        </p>
      </div>

      {/* 表格 */}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">采集批次</th>
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
                <td className="px-4 py-3 text-xs text-slate-400">
                  {r.crawlSessionId ? (
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono">
                      #{r.crawlSessionId}
                    </span>
                  ) : "-"}
                </td>
                <td className="px-4 py-3 text-slate-500">
                  {r.startedAt
                    ? new Date(r.startedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })
                    : "-"}
                </td>
                <td className="px-4 py-3 font-medium">
                  {siteNames[r.siteId ?? 0] ?? `站点 #${r.siteId ?? "?"}`}
                </td>
                <td className="px-4 py-3 text-emerald-600">{r.fetched}</td>
                <td className="px-4 py-3 text-indigo-600">{r.updated > 0 ? r.updated : "-"}</td>
                <td className="px-4 py-3 text-slate-400">{r.skipped}</td>
                <td className="px-4 py-3 text-red-500">
                  {r.errorCount > 0 ? r.errorCount : "-"}
                </td>
                <td className="px-4 py-3">{statusBadge(r.status)}</td>
                <td className="px-4 py-3 max-w-[200px] truncate text-xs text-slate-400">
                  {r.message ?? "-"}
                </td>
              </tr>
            ))}
            {!logs.length ? (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-slate-400">
                  暂无运行记录
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {/* 分页导航 */}
      <div className="mt-4 flex items-center justify-center gap-2">
        <button
          onClick={() => goPage(1)}
          disabled={page <= 1 || loading}
          className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100 disabled:opacity-30 transition-colors cursor-pointer"
        >
          首页
        </button>
        <button
          onClick={() => goPage(page - 1)}
          disabled={page <= 1 || loading}
          className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100 disabled:opacity-30 transition-colors cursor-pointer"
        >
          上一页
        </button>

        {/* 页码按钮 */}
        {(() => {
          const buttons: number[] = [];
          const start = Math.max(1, page - 2);
          const end = Math.min(totalPages, page + 2);
          for (let i = start; i <= end; i++) buttons.push(i);
          return buttons.map((p) => (
            <button
              key={p}
              onClick={() => goPage(p)}
              disabled={loading}
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
          disabled={page >= totalPages || loading}
          className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100 disabled:opacity-30 transition-colors cursor-pointer"
        >
          下一页
        </button>
        <button
          onClick={() => goPage(totalPages)}
          disabled={page >= totalPages || loading}
          className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100 disabled:opacity-30 transition-colors cursor-pointer"
        >
          末页
        </button>
      </div>

      {loading && (
        <p className="mt-2 text-center text-xs text-slate-400">加载中…</p>
      )}
    </div>
  );
}
