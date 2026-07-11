"use client";

import { useEffect, useState, useTransition, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Play, Square, Loader2 } from "lucide-react";
import { useToast } from "./Toast";

/** 仪表盘上的"立即采集 / 停止采集"按钮。 */
export function CrawlTrigger() {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [crawling, setCrawling] = useState(false);
  const [stopping, setStopping] = useState(false);

  // 轮询检测是否有采集在跑
  const checkRunning = useCallback(async () => {
    try {
      const res = await fetch("/api/runs/active");
      if (!res.ok) return;
      const data = await res.json();
      setCrawling(data.running && data.running.length > 0);
    } catch {
      // 静默
    }
  }, []);

  useEffect(() => {
    checkRunning();
    const t = setInterval(checkRunning, 5000);
    return () => clearInterval(t);
  }, [checkRunning]);

  async function trigger(siteId?: number) {
    startTransition(async () => {
      try {
        const res = await fetch("/api/crawl", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(siteId ? { siteId } : {}),
        });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        if (data.started) {
          toast.success(`已启动采集：${data.targetCount} 站 · 并发 ${data.concurrency}`);
          setCrawling(true);
        } else {
          toast.info("采集已开始");
        }
        router.refresh();
      } catch (e) {
        toast.error(`采集失败: ${(e as Error).message}`);
      }
    });
  }

  async function stop() {
    setStopping(true);
    try {
      const res = await fetch("/api/crawl/stop", { method: "POST" });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      if (data.stopped) {
        toast.success(`已中止，${data.abortedTasks} 个任务已标记为停止`);
        setCrawling(false);
      } else {
        toast.info("当前无运行中的采集任务");
      }
      router.refresh();
    } catch (e) {
      toast.error(`停止失败: ${(e as Error).message}`);
    } finally {
      setStopping(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      {crawling ? (
        <button
          onClick={stop}
          disabled={stopping}
          className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 bg-red-50 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-100 disabled:opacity-50 transition-colors dark:border-red-800 dark:bg-red-950/30 dark:text-red-400 dark:hover:bg-red-950/50"
        >
          {stopping ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Square className="h-4 w-4" />
          )}
          {stopping ? "正在停止..." : "停止采集"}
        </button>
      ) : (
        <button
          onClick={() => trigger()}
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 hover:shadow-md disabled:opacity-50 transition-all"
        >
          {pending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Play className="h-4 w-4 fill-white text-white" />
          )}
          立即采集全部
        </button>
      )}
    </div>
  );
}
