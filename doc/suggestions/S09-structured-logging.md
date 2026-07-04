# S09: 引入结构化日志

**关联分析**: [ANALYSIS.md](../ANALYSIS.md) → §8.2 中期改进

**优先级**: M1  
**涉及文件**: 全项目  
**预估工时**: 8h

---

## 原因

### 当前行为

整个项目使用 `console.log` / `console.error` 输出日志：

```typescript
console.log(`[cron] 完成：采集 ${crawled} 篇 · 审核 ${analyzed} 篇`);
console.error(`  [cron] #${s.id} ${s.name} 采集失败: ${msg}`);
```

这导致以下问题：
- **无日志级别**：无法区分 DEBUG / INFO / WARN / ERROR
- **无结构化字段**：日志是纯文本，无法用日志聚合工具（如 Loki、ELK）查询
- **无时间戳格式**：依赖 console 的默认时间戳
- **无请求追踪**：无法关联同一次采集的各站点日志
- **排查困难**：出现问题时只能 grep 文本

### 设计目标

引入 `pino`（轻量、高性能的结构化日志库），输出 JSON 格式日志。Docker 日志驱动可直接消费 JSON。

---

## 详细修改步骤

### 步骤 1：安装 pino

```bash
pnpm add pino
pnpm add -D pino-pretty  # 开发时格式化输出
```

### 步骤 2：创建日志配置

新建 `src/lib/logger.ts`：

```typescript
import pino from "pino";

const isDev = process.env.NODE_ENV !== "production";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (isDev ? "debug" : "info"),
  // 生产环境 JSON，开发环境用 pino-pretty 格式化
  transport: isDev
    ? {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "SYS:standard",
          ignore: "pid,hostname",
        },
      }
    : undefined,
  // 生产环境输出 JSON（Docker 日志驱动直接消费）
  ...(isDev ? {} : {
    formatters: {
      level(label) {
        return { level: label };
      },
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  }),
});

export type Logger = typeof logger;
```

### 步骤 3：创建子 Logger（含上下文）

```typescript
/** 为采集 session 创建带上下文的子 logger */
export function crawlLogger(sessionId: number) {
  return logger.child({ module: "crawl", sessionId });
}

/** 为 AI 审核创建带上下文的子 logger */
export function aiLogger() {
  return logger.child({ module: "ai" });
}

/** 为站点采集创建子 logger */
export function siteLogger(siteId: number, siteName: string) {
  return logger.child({ module: "crawl", siteId, siteName });
}
```

### 步骤 4：逐步替换各模块中的 console 调用

**采集器 (`runner.ts`)**:
```typescript
// 之前
console.log(`▶ #${s.id} ${s.name} [${s.render}] ...`);

// 之后
import { siteLogger } from "../lib/logger";
const log = siteLogger(site.id, site.name);
log.info({ render: site.render, urls: site.urls }, "开始采集站点");
```

**AI 审核 (`analyze.ts`)**:
```typescript
// 之前
console.log(`待审核 ${rows.length} 篇 · 并发 ${concurrency}`);

// 之后
import { aiLogger } from "../lib/logger";
const log = aiLogger();
log.info({ pending: rows.length, concurrency }, "开始AI审核");
```

**调度器 (`cron.ts`)**:
```typescript
// 之前
console.log(`[cron] 完成：采集 ${crawled} 篇 · 审核 ${analyzed} 篇`);

// 之后
log.info({ crawled, analyzed, durationSec, errors }, "定时任务完成");
```

### 步骤 5：在 API 路由中记录请求日志

```typescript
// 可在 middleware 中记录所有 API 请求
logger.info({
  method: request.method,
  path: pathname,
  ip: request.headers.get("x-forwarded-for"),
}, "API request");
```

### 步骤 6：验证

1. 开发模式下 (`pnpm dev`) 日志彩色格式化输出
2. 生产模式下 (`docker compose up`) JSON 格式输出:
   ```json
   {"level":"info","time":"2026-07-04T10:30:00.000Z","module":"crawl","sessionId":5,"msg":"开始采集站点"}
   ```
3. 使用 `docker compose logs` 可正常查看
4. 可配置 `LOG_LEVEL=debug` 查看更详细的日志

---

## 影响范围

| 影响 | 说明 |
|---|---|
| 代码变化 | 所有 console.log → logger.info 替换 |
| 日志格式 | 纯文本 → 结构化 JSON（生产） |
| 新依赖 | pino（~10KB gzip） |
| 开发体验 | 开发时 prettier 输出，生产 JSON |
