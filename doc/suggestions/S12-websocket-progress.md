# S12: 全局采集进度 WebSocket

**关联分析**: [ANALYSIS.md](../ANALYSIS.md) → §8.2 中期改进

**优先级**: M4  
**涉及文件**: 新建 `app/api/runs/ws/route.ts`, 修改 `app/components/LiveProgress.tsx`  
**预估工时**: 6h

---

## 原因

### 当前行为

`LiveProgress.tsx` 每 3 秒轮询 `GET /api/runs/active`：

```typescript
useEffect(() => {
  poll();
  const t = setInterval(poll, 3000);
  return () => clearInterval(t);
}, [poll]);
```

这导致：
- **延迟**：采集完成需要最多 3 秒后才在 UI 反映
- **资源浪费**：无采集任务时仍在轮询
- **后端压力**：每个打开的浏览器标签都会 3s 一次 DB 查询
- **不精确进度**：站点级别的进度更新不及时

### 设计目标

使用 Server-Sent Events (SSE) 替代轮询，采集过程中通过事件总线推送进度更新。

---

## 详细修改步骤

### 步骤 1：创建事件总线

新建 `src/lib/events.ts`：

```typescript
import { EventEmitter } from "node:events";

type CrawlEvent =
  | { type: "site:start"; siteId: number; siteName: string }
  | { type: "site:done"; siteId: number; siteName: string; fetched: number; updated: number; status: string }
  | { type: "site:error"; siteId: number; siteName: string; error: string }
  | { type: "crawl:complete"; sessionId: number; summary: { totalFetched: number; status: string } }
  | { type: "ai:progress"; remaining: number; done: number };

export const crawlEvents = new EventEmitter();
crawlEvents.setMaxListeners(50); // 允许多个 SSE 连接

/** 通知所有监听者 */
export function emitCrawlEvent(event: CrawlEvent) {
  crawlEvents.emit("update", event);
}
```

### 步骤 2：在采集 pipeline 中发出事件

修改 `src/pipeline/service.ts`（见 S02），在每个站点完成时 emit 事件：

```typescript
import { emitCrawlEvent } from "../lib/events";

// 在 runSite 完成后
emitCrawlEvent({
  type: "site:done",
  siteId: s.id,
  siteName: s.name,
  fetched: r.fetched,
  updated: r.updated,
  status: r.status,
});
```

### 步骤 3：创建 SSE 端点

新建 `app/api/runs/ws/route.ts`：

```typescript
import { NextRequest } from "next/server";
import { crawlEvents } from "@/src/lib/events";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const encoder = new TextEncoder();
  
  const stream = new ReadableStream({
    start(controller) {
      // 发送初始连接成功消息
      controller.enqueue(encoder.encode("event: connected\ndata: {}\n\n"));

      const listener = (event: any) => {
        const data = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
        try {
          controller.enqueue(encoder.encode(data));
        } catch {
          // 客户端已断开
          crawlEvents.off("update", listener);
        }
      };

      crawlEvents.on("update", listener);

      // 心跳保持连接
      const keepAlive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {
          clearInterval(keepAlive);
        }
      }, 15000);

      // 客户端断开时清理
      request.signal.addEventListener("abort", () => {
        crawlEvents.off("update", listener);
        clearInterval(keepAlive);
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // 禁用 nginx 缓冲
    },
  });
}
```

### 步骤 4：更新前端 LiveProgress 组件

```typescript
// LiveProgress.tsx
"use client";

import { useEffect, useState, useRef } from "react";

export function LiveProgress() {
  const [data, setData] = useState<ProgressData | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    // 首次加载仍用 REST API 获取当前状态
    fetch("/api/runs/active")
      .then(r => r.json())
      .then(setData)
      .catch(() => {});

    // 建立 SSE 连接
    const es = new EventSource("/api/runs/ws");
    eventSourceRef.current = es;

    es.addEventListener("site:done", (e) => {
      const event = JSON.parse(e.data);
      setData(prev => {
        if (!prev) return prev;
        // 增量更新：将对应站点从 running 移到 recent
        return {
          ...prev,
          running: prev.running.filter(r => r.siteId !== event.siteId),
          recent: [
            {
              id: Date.now(),
              siteId: event.siteId,
              siteName: event.siteName,
              status: event.status,
              fetched: event.fetched,
              updated: event.updated,
              skipped: 0,
              errorCount: 0,
              startedAt: null,
              endedAt: new Date().toISOString(),
              message: null,
            },
            ...prev.recent,
          ].slice(0, 20),
        };
      });
    });

    es.addEventListener("crawl:complete", (e) => {
      const event = JSON.parse(e.data);
      setData(prev => prev ? { ...prev, running: [] } : prev);
      // 触发一次完整刷新
      fetch("/api/runs/active")
        .then(r => r.json())
        .then(setData);
    });

    es.onerror = () => {
      // SSE 连接失败时回退到轮询
      es.close();
    };

    return () => {
      es.close();
    };
  }, []);

  // ... 渲染逻辑不变
}
```

### 步骤 5：在 API 路由中发出事件

修改 `app/api/crawl/route.ts` 的 `onSiteDone` 回调：

```typescript
// 在 runCrawl 的 onSiteDone 回调中
onSiteDone: (site, result) => {
  emitCrawlEvent({
    type: "site:done",
    siteId: site.id,
    siteName: site.name,
    fetched: result.fetched,
    updated: result.updated,
    status: result.status,
  });
}
```

### 步骤 6：验证

1. 打开仪表盘 → SSE 连接建立（Network 面板看到 EventStream）
2. 触发采集 → 实时看到站点逐个完成
3. 进度条实时更新（不再是 3s 延迟）
4. 采集完成后 → 自动刷新状态

---

## 影响范围

| 影响 | 说明 |
|---|---|
| 实时性 | 从 3s 延迟 → <100ms 延迟 |
| 服务器负载 | 减少无效轮询请求（无采集时不再轮询） |
| 浏览器兼容 | EventSource (SSE) 支持所有现代浏览器 |
| 并发连接 | 每个标签一个 SSE 连接，需注意 EventEmitter 监听器上限 |
