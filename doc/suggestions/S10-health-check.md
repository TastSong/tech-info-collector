# S10: 健康检查 API

**关联分析**: [ANALYSIS.md](../ANALYSIS.md) → §8.2 中期改进

**优先级**: M2  
**涉及文件**: 新建 `app/api/health/route.ts`  
**预估工时**: 2h

---

## 原因

### 当前行为

Docker Compose 中的 healthcheck 只检查 HTTP 200：

```yaml
healthcheck:
  test: ["CMD", "node", "-e", "require('http').get('http://localhost:4040',r=>{process.exit(r.statusCode===200?0:1)})"]
```

这只能验证 "Next.js 进程在运行"，无法验证：
- SQLite 数据库是否可读写
- Playwright 浏览器是否可用
- 最近一次采集是否成功完成
- 调度器是否正常运行

### 设计目标

提供一个 `/api/health` 端点，返回关键组件的健康状况。

---

## 详细修改步骤

### 步骤 1：创建健康检查 API

新建 `app/api/health/route.ts`：

```typescript
import { NextResponse } from "next/server";
import { db, schema } from "@/db/client";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

interface HealthStatus {
  status: "healthy" | "degraded" | "unhealthy";
  timestamp: string;
  uptime: number;
  checks: {
    database: { status: string; latencyMs: number };
    browser?: { status: string; error?: string };
    scheduler: { status: string; lastRun?: string };
    lastCrawl: { status: string; lastSuccessAt?: string; hoursSince?: number };
  };
}

export async function GET() {
  const checks: HealthStatus["checks"] = {} as any;
  let overall: HealthStatus["status"] = "healthy";

  // 1. 数据库健康检查
  try {
    const start = Date.now();
    db.select({ n: sql`1` }).from(schema.sites).limit(1).all();
    checks.database = {
      status: "healthy",
      latencyMs: Date.now() - start,
    };
  } catch (e) {
    checks.database = {
      status: "unhealthy",
      latencyMs: -1,
    };
    overall = "unhealthy";
  }

  // 2. Playwright 浏览器检查（可选，按需加载）
  try {
    const { getBrowser } = await import("@/src/crawler/playwright");
    const browser = await getBrowser();
    const contexts = browser.contexts();
    checks.browser = {
      status: "healthy",
      contextCount: contexts.length,
    };
  } catch (e) {
    checks.browser = {
      status: "unhealthy",
      error: (e as Error).message,
    };
    overall = overall === "healthy" ? "degraded" : overall;
  }

  // 3. 调度器检查
  let schedulerStatus = "unknown";
  try {
    const { default: cron } = await import("node-cron");
    const tasks = cron.getTasks();
    schedulerStatus = tasks.size > 0 ? "running" : "stopped";
  } catch {
    schedulerStatus = "unknown";
  }
  checks.scheduler = { status: schedulerStatus };

  // 4. 最近采集检查
  const lastSuccess = db
    .select()
    .from(schema.crawlSessions)
    .where(sql`status = 'success'`)
    .orderBy(sql`ended_at DESC`)
    .limit(1)
    .all()
    .at(0);

  if (lastSuccess?.endedAt) {
    const endedAt = new Date(lastSuccess.endedAt).getTime();
    const hoursSince = (Date.now() - endedAt) / (1000 * 60 * 60);
    checks.lastCrawl = {
      status: hoursSince > 24 ? "stale" : "healthy",
      lastSuccessAt: new Date(endedAt).toISOString(),
      hoursSince: Math.round(hoursSince * 10) / 10,
    };
  } else {
    checks.lastCrawl = { status: "never" };
  }

  return NextResponse.json(
    {
      status: overall,
      timestamp: new Date().toISOString(),
      uptime: Math.floor(process.uptime()),
      checks,
    } satisfies HealthStatus,
    { status: overall === "healthy" ? 200 : 503 }
  );
}
```

### 步骤 2：更新 Docker Compose healthcheck

```yaml
healthcheck:
  test: ["CMD", "node", "-e",
    "require('http').get('http://localhost:4040/api/health',r=>{
      let d=''; r.on('data',c=>d+=c);
      r.on('end',()=>{
        try{
          const j=JSON.parse(d);
          process.exit(j.status==='healthy'||j.status==='degraded'?0:1)
        }catch{process.exit(1)}
      })
    })"]
  interval: 30s
  timeout: 10s
  retries: 3
  start_period: 20s
```

### 步骤 3：添加 `/_health` 简化端点（可选）

```typescript
// 在 root layout 或 middleware 中处理 /_health 简单端点
// 用于 Kubernetes liveness probe（不需要 JSON 解析）
```

### 步骤 4：验证

1. 正常情况：`{"status":"healthy","checks":{"database":{"status":"healthy"}...}}`
2. DB 文件损坏：`{"status":"unhealthy"}` + 503 状态码
3. Docker healthcheck 日志：`docker compose ps` 显示 healthy

---

## 影响范围

| 影响 | 说明 |
|---|---|
| API 路径 | 新增 `GET /api/health`（需在 middleware 中列为公开路径） |
| 性能 | 每次健康检查约 5-20ms（含 DB 查询和浏览器检查） |
| 安全性 | 应作为公开端点（不强制登录） |
