"use client";

import { useEffect, useState, useCallback } from "react";
import { Globe, Sparkles, CheckCircle2, Loader2 } from "lucide-react";

interface SessionInfo {
  id: number;
  status: string;
  siteCount: number;
  completedCount: number;
}

interface AnalyzeInfo {
  remaining: number;
  processing: number;
}

interface ProgressData {
  running: Array<{
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
  }>;
  recent: Array<{
    id: number;
    siteName: string | null;
    fetched: number;
    updated: number;
  }>;
  session: SessionInfo | null;
  phase: "idle" | "crawling" | "analyzing";
  analyze: AnalyzeInfo | null;
}

interface StepDef {
  key: string;
  label: string;
  icon: typeof Globe;
  summary: string;
}

const STEPS: StepDef[] = [
  { key: "crawling", label: "采集站点", icon: Globe, summary: "正在抓取各站点内容…" },
  { key: "analyzing", label: "AI 分析", icon: Sparkles, summary: "LLM 审核文章质量与相关度…" },
];

function getStepState(stepKey: string, phase: string): "done" | "active" | "pending" {
  if (stepKey === "crawling") {
    if (phase === "crawling") return "active";
    if (phase === "analyzing") return "done";
    return "pending";
  }
  if (stepKey === "analyzing") {
    if (phase === "analyzing") return "active";
    return "pending";
  }
  return "pending";
}

/** 总体进度面板：以步骤条展示"采集 → 分析"两阶段流水线。 */
export function OverallProgress() {
  const [data, setData] = useState<ProgressData | null>(null);

  const poll = useCallback(async () => {
    try {
      const res = await fetch("/api/runs/active");
      if (!res.ok) return;
      const json = await res.json();
      setData(json);
    } catch {
      // 静默失败，等待下一次轮询
    }
  }, []);

  useEffect(() => {
    poll();
    const t = setInterval(poll, 3000);
    return () => clearInterval(t);
  }, [poll]);

  // 空闲态：不显示
  if (!data || data.phase === "idle") return null;

  const { phase, session, analyze, running } = data;

  // ── 采集阶段进度 ──
  const siteDone = session?.completedCount ?? 0;
  const siteTotal = session?.siteCount ?? 0;
  const crawlPercent =
    siteTotal > 0 ? Math.round((siteDone / siteTotal) * 100) : 0;

  // 采集阶段汇总
  const crawlFetched = running.reduce((s, r) => s + r.fetched, 0);
  const crawlUpdated = running.reduce((s, r) => s + r.updated, 0);
  const crawlErrors = running.reduce((s, r) => s + r.errorCount, 0);

  // ── 分析阶段详情 ──
  const remaining = analyze?.remaining ?? 0;
  const processing = analyze?.processing ?? 0;

  return (
    <section className="mb-10 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
      <h2 className="mb-4 text-sm font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400">
        总体进度
      </h2>

      {/* 步骤条 */}
      <div className="mb-5 flex items-center gap-0">
        {STEPS.map((step, i) => {
          const state = getStepState(step.key, phase);
          const Icon = step.icon;
          const isLast = i === STEPS.length - 1;

          return (
            <div key={step.key} className="flex items-center flex-1 last:flex-none">
              {/* 步骤圆圈 */}
              <div className="flex flex-col items-center gap-1.5">
                <div
                  className={`flex h-10 w-10 items-center justify-center rounded-full border-2 transition-all duration-500 ${
                    state === "done"
                      ? "border-emerald-400 bg-emerald-50 text-emerald-600 dark:border-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400"
                      : state === "active"
                        ? "border-indigo-400 bg-indigo-50 text-indigo-600 shadow-[0_0_12px_rgba(99,102,241,0.3)] dark:border-indigo-500 dark:bg-indigo-950/40 dark:text-indigo-400"
                        : "border-slate-200 bg-slate-50 text-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-600"
                  }`}
                >
                  {state === "done" ? (
                    <CheckCircle2 className="h-5 w-5" />
                  ) : state === "active" ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <Icon className="h-5 w-5" />
                  )}
                </div>
                <span
                  className={`text-xs font-medium whitespace-nowrap ${
                    state === "done"
                      ? "text-emerald-600 dark:text-emerald-400"
                      : state === "active"
                        ? "text-indigo-600 dark:text-indigo-400"
                        : "text-slate-400 dark:text-slate-500"
                  }`}
                >
                  {step.label}
                </span>
              </div>

              {/* 连接线 */}
              {!isLast && (
                <div className="mx-2 mb-5 flex-1 h-0.5 rounded-full transition-colors duration-500"
                  style={{
                    background:
                      state === "done"
                        ? "linear-gradient(to right, #34d399, #a5b4fc)"
                        : state === "active"
                          ? "linear-gradient(to right, #a5b4fc, #e2e8f0)"
                          : "#e2e8f0",
                  }}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* 当前阶段详情 */}
      <div className="rounded-lg bg-slate-50 p-4 dark:bg-slate-800/50">
        {phase === "crawling" && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium text-indigo-700 dark:text-indigo-400">
              <span className="inline-flex h-2.5 w-2.5 rounded-full bg-indigo-500 animate-pulse" />
              正在执行：采集站点
            </div>

            {/* 进度条 */}
            {siteTotal > 0 && (
              <div className="space-y-1">
                <div className="flex justify-between text-xs text-slate-500">
                  <span>
                    站点进度 {siteDone}/{siteTotal}
                  </span>
                  <span>{crawlPercent}%</span>
                </div>
                <div className="h-2 rounded-full bg-slate-200 overflow-hidden dark:bg-slate-700">
                  <div
                    className="h-full rounded-full bg-indigo-500 transition-all duration-700"
                    style={{ width: `${crawlPercent}%` }}
                  />
                </div>
              </div>
            )}

            {/* 汇总数据 */}
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
              {crawlFetched > 0 && (
                <span>
                  新采 <span className="font-medium text-emerald-600">{crawlFetched}</span> 篇
                </span>
              )}
              {crawlUpdated > 0 && (
                <span>
                  更新 <span className="font-medium text-indigo-600">{crawlUpdated}</span> 篇
                </span>
              )}
              {crawlErrors > 0 && (
                <span>
                  错误 <span className="font-medium text-red-500">{crawlErrors}</span> 个
                </span>
              )}
              {running.length > 0 && (
                <span>
                  进行中 <span className="font-medium">{running.filter((r) => r.status === "running").length}</span> 个站点
                </span>
              )}
            </div>
          </div>
        )}

        {phase === "analyzing" && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium text-purple-700 dark:text-purple-400">
              <span className="inline-flex h-2.5 w-2.5 rounded-full bg-purple-500 animate-pulse" />
              正在执行：AI 分析
            </div>

            {/* 分析进度 */}
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-slate-500">
                <span>
                  待审核 <span className="font-medium text-purple-600">{remaining}</span> 篇
                </span>
                {processing > 0 && (
                  <span>
                    审核中 <span className="font-medium text-indigo-600">{processing}</span> 篇
                  </span>
                )}
              </div>
              {/* 不确定进度条（脉冲动画） */}
              <div className="h-2 rounded-full bg-slate-200 overflow-hidden dark:bg-slate-700">
                <div className="h-full w-1/3 rounded-full bg-purple-400 animate-pulse" />
              </div>
            </div>

            <p className="text-xs text-slate-400">
              {remaining > 0
                ? `${STEPS[1].summary} (剩余 ${remaining} 篇)`
                : "AI 分析即将完成…"}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
