"use client";

import { useState, useTransition, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";

/**
 * 文章操作按钮（客户端组件）：approve / reject / re-analyze。
 * 通过 PUT /api/articles/[id] 发送操作。
 */
export function ArticleActions({
  articleId,
  currentStatus,
  apiPath = `/api/articles/${articleId}`,
}: {
  articleId: number;
  currentStatus: string;
  apiPath?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState("");

  async function act(action: "approve" | "reject") {
    setMsg("");
    startTransition(async () => {
      try {
        const res = await fetch(apiPath, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action }),
        });
        if (!res.ok) throw new Error(await res.text());
        setMsg(action === "approve" ? "✓ 已发布" : "✗ 已驳回");
        router.refresh();
      } catch (e) {
        setMsg(`操作失败: ${(e as Error).message}`);
      }
    });
  }

  return (
    <div className="flex items-center gap-3">
      {currentStatus === "review" || currentStatus === "ready" ? (
        <>
          <button
            onClick={() => act("approve")}
            disabled={pending}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            确认发布
          </button>
          <button
            onClick={() => act("reject")}
            disabled={pending}
            className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-100 disabled:opacity-50"
          >
            驳回
          </button>
        </>
      ) : null}
      {msg ? (
        <span className="text-xs text-slate-500">{msg}</span>
      ) : null}
    </div>
  );
}

/** 仪表盘上的"立即采集 / 停止采集"按钮。 */
export function CrawlTrigger() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState("");
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
    setMsg("");
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
          setMsg(
            `✓ 已启动 ${data.targetCount} 站 (${data.groupCount} 域名组, 并发${data.concurrency})`,
          );
          setCrawling(true);
        } else {
          setMsg(`✓ 采集已开始`);
        }
        router.refresh();
      } catch (e) {
        setMsg(`失败: ${(e as Error).message}`);
      }
    });
  }

  async function stop() {
    setMsg("");
    setStopping(true);
    try {
      const res = await fetch("/api/crawl/stop", { method: "POST" });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      if (data.stopped) {
        setMsg(`⊘ 已中止，${data.abortedTasks} 个运行中任务已标记为停止`);
        setCrawling(false);
      } else {
        setMsg(`当前无运行中的采集任务`);
      }
      router.refresh();
    } catch (e) {
      setMsg(`停止失败: ${(e as Error).message}`);
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
          className="rounded-lg border border-red-300 bg-red-50 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-100 disabled:opacity-50"
        >
          {stopping ? "正在停止..." : "停止采集"}
        </button>
      ) : (
        <button
          onClick={() => trigger()}
          disabled={pending}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          立即采集全部
        </button>
      )}
      {msg ? (
        <span className="text-xs text-slate-500">{msg}</span>
      ) : null}
    </div>
  );
}
