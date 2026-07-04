# S15: 采集 Worker 分离

**关联分析**: [ANALYSIS.md](../ANALYSIS.md) → §8.3 长期改进

**优先级**: L2（架构级）  
**涉及文件**: 新建 `src/worker/`, 修改 `src/pipeline/`  
**预估工时**: 20-30h

---

## 原因

### 当前行为

所有采集和 AI 审核逻辑在 Next.js 进程内执行：

```typescript
// app/api/crawl/route.ts
export async function POST(req: Request) {
  // ... 立即返回 200
  // 然后后台执行采集（仍在同一个 Node.js 进程中）
  q.onIdle().then(() => { ... });
}
```

这导致：
- **资源竞争**：采集（尤其是 Playwright）消耗大量 CPU/内存，影响 Web 响应
- **进程耦合**：采集导致进程 OOM → Web 服务也一起崩溃
- **不可扩展**：采集 Worker 和 Web Server 强绑定在单进程中
- **部署风险**：重启 Web 服务会中止正在进行的采集

### 设计目标

将采集和 AI 审核逻辑移到独立 Worker 进程，通过轻量级消息队列通信。

---

## 详细修改步骤

### 步骤 1：选择 Worker 架构

推荐方案：**独立进程 + SQLite 消息表**（避免引入 Redis/BullMQ 的额外运维负担）

```
┌─────────────────┐     poll tasks      ┌──────────────────┐
│  Next.js Server  │ ──────────────────> │  Crawl Worker    │
│  (Web + API)     │ <── status update ─ │  (独立进程)       │
│  :4040           │     via DB          │                  │
└─────────────────┘                      └──────────────────┘
```

### 步骤 2：创建任务表

在 `db/schema.ts` 中新增：

```typescript
export const crawlTasks = sqliteTable("crawl_tasks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  type: text("type", { enum: ["crawl", "analyze"] }).notNull(),
  payload: text("payload", { mode: "json" }).$type<{
    siteId?: number;
    opts?: Record<string, unknown>;
  }>(),
  status: text("status", {
    enum: ["pending", "running", "completed", "failed"],
  }).notNull().default("pending"),
  priority: integer("priority").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  startedAt: integer("started_at", { mode: "timestamp" }),
  completedAt: integer("completed_at", { mode: "timestamp" }),
  result: text("result", { mode: "json" }).$type<object>(),
  error: text("error"),
  maxRetries: integer("max_retries").notNull().default(3),
  retryCount: integer("retry_count").notNull().default(0),
});
```

### 步骤 3：修改 Web 端——创建任务而非直接执行

```typescript
// app/api/crawl/route.ts
export async function POST(req: Request) {
  const body = await req.json();
  
  // 创建任务记录
  const taskId = db.insert(schema.crawlTasks).values({
    type: "crawl",
    payload: { siteId: body.siteId },
    status: "pending",
    createdAt: new Date(),
  }).run().lastInsertRowid;
  
  return NextResponse.json({
    started: true,
    taskId,
    message: "采集任务已加入队列",
  });
}
```

### 步骤 4：创建 Worker 进程

新建 `src/worker/index.ts`：

```typescript
/**
 * 采集 Worker — 独立进程，轮询 crawl_tasks 表执行任务。
 * pnpm worker
 */
import { eq, asc } from "drizzle-orm";
import { db, schema } from "../../db/client";
import { runCrawl } from "../pipeline/service";
import { analyzePending } from "../ai/analyze";

const POLL_INTERVAL_MS = 5000;
let running = true;

process.on("SIGTERM", () => { running = false; });
process.on("SIGINT", () => { running = false; });

async function poll() {
  while (running) {
    const task = db
      .select()
      .from(schema.crawlTasks)
      .where(eq(schema.crawlTasks.status, "pending"))
      .orderBy(asc(schema.crawlTasks.priority), asc(schema.crawlTasks.createdAt))
      .limit(1)
      .all()
      .at(0);

    if (!task) {
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
      continue;
    }

    // 标记为运行中
    db.update(schema.crawlTasks)
      .set({ status: "running", startedAt: new Date() })
      .where(eq(schema.crawlTasks.id, task.id))
      .run();

    try {
      let result: unknown;
      if (task.type === "crawl") {
        result = await runCrawl({
          siteId: task.payload?.siteId,
          concurrency: task.payload?.opts?.concurrency as number | undefined,
        });
      } else if (task.type === "analyze") {
        await analyzePending({});
        result = { done: true };
      }

      db.update(schema.crawlTasks)
        .set({
          status: "completed",
          completedAt: new Date(),
          result: result as object,
        })
        .where(eq(schema.crawlTasks.id, task.id))
        .run();
    } catch (e) {
      const msg = (e as Error).message;
      const newRetryCount = task.retryCount + 1;
      
      db.update(schema.crawlTasks)
        .set({
          status: newRetryCount >= task.maxRetries ? "failed" : "pending",
          error: msg,
          retryCount: newRetryCount,
          completedAt: new Date(),
        })
        .where(eq(schema.crawlTasks.id, task.id))
        .run();
    }
  }

  console.log("[worker] 正常退出");
}

console.log("[worker] 启动采集 Worker...");
poll();
```

### 步骤 5：添加 Worker 到 package.json

```json
{
  "scripts": {
    "worker": "tsx src/worker/index.ts"
  }
}
```

### 步骤 6：更新 Docker Compose

```yaml
services:
  app:
    # ... Web 服务不变
    command: ["docker-entrypoint.sh"]

  worker:
    build: .
    image: tech-info-collector:latest
    container_name: tech-info-collector-worker
    command: ["sh", "-c", "node scripts/init-db.cjs && npx tsx src/worker/index.ts"]
    env_file: .env
    environment:
      - NODE_ENV=production
    volumes:
      - collector_data:/app/data
    restart: unless-stopped
    depends_on:
      - app
```

### 步骤 7：处理进程间协调

- Web 端创建任务、查询任务状态 → 通过 `crawl_tasks` 表
- Worker 执行采集 → 直接操作 DB（与 Web 不冲突）
- 进度展示 → Web API 读取 `run_logs` 表（Worker 写入）

### 步骤 8：验证

1. `docker compose up` → 两个容器启动（app + worker）
2. 触发采集 → 任务创建 → worker 领取执行
3. Web 服务不因采集而响应变慢
4. worker 崩溃不影响 Web 服务
5. 任务重试逻辑正常

---

## 影响范围

| 影响 | 说明 |
|---|---|
| 进程隔离 | 采集崩溃不影响 Web 服务 |
| 任务持久化 | 重启不丢失待执行任务 |
| 并发控制 | Worker 单进程串行执行（如需多 Worker，需加锁） |
| 运维 | 多一个容器，docker-compose 管理 |
