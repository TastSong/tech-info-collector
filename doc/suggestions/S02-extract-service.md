# S02: 抽取公共采集服务层，消除 CLI/API 重复

**关联分析**: [ANALYSIS.md](../ANALYSIS.md) → §8.1 短期改进

**优先级**: P0（高优先）  
**涉及文件**: 新建 `src/pipeline/service.ts`，修改 `src/pipeline/cli.ts`、`app/api/crawl/route.ts`  
**预估工时**: 6h

---

## 原因

### 当前行为

`cli.ts` 和 `route.ts` 中有约 80% 的逻辑是重复的：

| 逻辑片段 | cli.ts | route.ts |
|---|---|---|
| `groupByHost()` | 行 18-30 | 行 23-33 |
| 查询目标站点 | 行 36-42 | 行 44-54 |
| 过滤无选择器站点 | 行 50-53 | 行 63-65 |
| 创建 crawl session | 行 64-75 | 行 74-83 |
| 控制队列 + 域名分组并行 | 行 82-103 | 行 88-105 |
| 结束后汇总 session | 行 107-139 | 行 108-141 |
| 自动触发 analyzePending | 行 138-139 | 行 143-144 |

### 风险评估

这是经典的 **代码异味 "Duplicated Code"**：
- 修改采集编排逻辑时必须同步两处
- 历史上这两处的行为已经出现不一致（如 cron.ts 用 MAX_CONCURRENT=2，而 cli.ts/route.ts 用 CONCURRENCY=10）
- 未来新增入口（如消息驱动采集）会进一步恶化

### 设计目标

新建 `src/pipeline/service.ts`，将三处入口（CLI、Web API、Cron）共享的采集编排逻辑提取为单一函数。

---

## 详细修改步骤

### 步骤 1：创建 `src/pipeline/service.ts`

```typescript
import { eq } from "drizzle-orm";
import PQueue from "p-queue";
import { db, schema } from "../../db/client";
import type { Site } from "./types";
import { runSite, type RunResult } from "./runner";
import { closeBrowser } from "../crawler/playwright";
import { analyzePending } from "../ai/analyze";

export interface CrawlOptions {
  /** 指定站点 ID 采集，省略则采集所有 enabled 站点 */
  siteId?: number;
  /** 跨域名并行数 */
  concurrency?: number;
  /** 是否在采集后自动 AI 分析 */
  autoAnalyze?: boolean;
  /** AbortSignal（从 Web API 传入） */
  signal?: AbortSignal;
  /** 进度回调（每次站点完成时调用） */
  onSiteDone?: (site: Site, result: RunResult) => void;
}

export interface CrawlSummary {
  sessionId: number;
  totalFetched: number;
  totalUpdated: number;
  totalSkipped: number;
  totalErrors: number;
  status: "success" | "partial" | "error" | "aborted";
}

function groupByHost(sites: Site[]): Site[][] {
  const map = new Map<string, Site[]>();
  for (const s of sites) {
    let host = "unknown";
    try { host = new URL(s.urls[0]).host; } catch {}
    const list = map.get(host);
    if (list) list.push(s);
    else map.set(host, [s]);
  }
  return [...map.values()];
}

export async function runCrawl(opts: CrawlOptions = {}): Promise<{
  skipped: Site[];
  summary: CrawlSummary;
}> {
  const concurrency = opts.concurrency ?? Number(process.env.CRAWL_CONCURRENCY ?? 10);
  const autoAnalyze = opts.autoAnalyze ?? true;

  // 1. 查询目标站点
  const targets = opts.siteId
    ? db.select().from(schema.sites).where(eq(schema.sites.id, opts.siteId)).all()
    : db.select().from(schema.sites).where(eq(schema.sites.enabled, true)).all();

  if (!targets.length) {
    throw new Error(opts.siteId ? `未找到站点 #${opts.siteId}` : "没有 enabled 的站点");
  }

  const ready = targets.filter(s => s.listSelector);
  const skipped = targets.filter(s => !s.listSelector);

  for (const s of skipped) {
    console.log(`⊘ #${s.id} ${s.name} — 未配置选择器，跳过`);
  }

  if (!ready.length) {
    return { skipped, summary: { sessionId: 0, totalFetched: 0, totalUpdated: 0, totalSkipped: 0, totalErrors: 0, status: "success" } };
  }

  // 2. 创建 crawl session
  const sessionCount = db.select().from(schema.crawlSessions).all().length;
  const sessionIndex = sessionCount + 1;
  const sessionId = (
    db.insert(schema.crawlSessions)
      .values({ startedAt: new Date(), status: "running", siteCount: ready.length })
      .run().lastInsertRowid as number
  ) ?? 1;

  console.log(`\n=== 第 ${sessionIndex} 次采集 ===`);
  console.log(`并行采集 ${ready.length} 站 (${groupByHost(ready).length} 域名组) · 并发=${concurrency}\n`);

  // 3. 按域名分组并行
  const groups = groupByHost(ready);
  const q = new PQueue({ concurrency });
  let totalFetched = 0;

  for (const group of groups) {
    q.add(async () => {
      for (const s of group) {
        if (opts.signal?.aborted) break;
        process.stdout.write(`▶ #${s.id} ${s.name} [${s.render}] ...`);
        try {
          const r = await runSite(s, sessionId);
          console.log(` ✓ 新${r.fetched} 变${r.updated} 跳${r.skipped} 错${r.errorCount} (${r.status})`);
          totalFetched += r.fetched + r.updated;
          opts.onSiteDone?.(s, r);
        } catch (e) {
          console.log(` ✗ ${(e as Error).message}`);
        }
      }
    });
  }

  await q.onIdle();

  // 4. 关闭浏览器
  if (!opts.signal?.aborted) {
    await closeBrowser().catch(() => {});
  }

  // 5. 汇总 session
  const sessionRuns = db.select()
    .from(schema.runLogs)
    .where(eq(schema.runLogs.crawlSessionId, sessionId))
    .all();
  const totalErrors = sessionRuns.reduce((s, r) => s + r.errorCount, 0);
  const totalUpdated = sessionRuns.reduce((s, r) => s + r.updated, 0);
  const totalSkipped = sessionRuns.reduce((s, r) => s + r.skipped, 0);
  const hasErrors = totalErrors > 0;
  const hasPartial = sessionRuns.some(r => r.status === "partial");
  const status: CrawlSummary["status"] =
    opts.signal?.aborted ? "aborted"
    : hasErrors && totalFetched === 0 ? "error"
    : hasPartial || hasErrors ? "partial"
    : "success";

  db.update(schema.crawlSessions)
    .set({ endedAt: new Date(), status, totalFetched, totalUpdated, totalSkipped, totalErrors })
    .where(eq(schema.crawlSessions.id, sessionId))
    .run();

  console.log(`\n采集完成，共采集 ${totalFetched} 篇新文章。`);

  // 6. 自动 AI 分析
  if (autoAnalyze && !opts.signal?.aborted) {
    console.log("开始 AI 分析…");
    await analyzePending({ concurrency });
    console.log("AI 分析完成。");
  }

  return {
    skipped,
    summary: { sessionId, totalFetched, totalUpdated, totalSkipped, totalErrors, status },
  };
}
```

### 步骤 2：重写 `cli.ts`

```typescript
// 删除 groupByHost 函数和 main 函数中的所有编排逻辑
// 替换为：

import { runCrawl } from "./service";

async function main() {
  const idArg = process.argv[2];
  const id = idArg ? Number(idArg) : null;
  
  try {
    const { summary } = await runCrawl({
      siteId: id ?? undefined,
      concurrency: Number(process.env.CRAWL_CONCURRENCY ?? 10),
    });
    process.exit(summary.status === "error" ? 1 : 0);
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
}

main();
```

### 步骤 3：重写 `route.ts`

```typescript
// 删除 groupByHost 函数和 POST handler 中的编排逻辑
// 替换为：

import { runCrawl } from "@/src/pipeline/service";

export async function POST(req: Request) {
  let siteId: number | undefined;
  try {
    const body = (await req.json().catch(() => ({}))) as { siteId?: number };
    siteId = body.siteId;
  } catch {}

  try {
    const { skipped } = await runCrawl({
      siteId,
      concurrency: Number(process.env.CRAWL_CONCURRENCY ?? 10),
      autoAnalyze: true,
    });

    return NextResponse.json({
      started: true,
      skippedNames: skipped.map(s => s.name),
    });
  } catch (e) {
    if ((e as Error).message.includes("未找到")) {
      return NextResponse.json({ error: (e as Error).message }, { status: 404 });
    }
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
```

### 步骤 4：同步更新 `cron.ts`

```typescript
// cron.ts 中调用 runAll 时也改为使用 service

import { runCrawl } from "../pipeline/service";

export async function runAll() {
  // ... 前面的逻辑保持不变
  
  const { summary } = await runCrawl({
    concurrency: 2, // cron 用低并发
    autoAnalyze: true,
    signal: undefined,
  });
  
  // ... 通知逻辑
}
```

### 步骤 5：验证

1. `pnpm crawl` 行为与修改前一致
2. `POST /api/crawl` 行为与修改前一致
3. cron 定时采集行为与修改前一致
4. 验证单个站点采集 `pnpm crawl 3` 正常工作
5. 验证中止功能仍然有效

---

## 影响范围

| 影响 | 说明 |
|---|---|
| 文件变更 | 新增 1 个文件，修改 3 个文件 |
| 行数变化 | 新增约 130 行，删除约 120 行重复代码 |
| API 兼容 | 完全向后兼容 |
| 行为变更 | 无行为变更（纯重构） |
| 测试 | 需要验证 CLI + Web + Cron 三种入口 |
