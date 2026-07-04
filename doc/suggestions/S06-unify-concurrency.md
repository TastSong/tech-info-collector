# S06: 统一 Cron vs CLI vs API 的并发配置

**关联分析**: [ANALYSIS.md](../ANALYSIS.md) → §8.1 短期改进

**优先级**: P2（中等）  
**涉及文件**: `src/scheduler/cron.ts`, `src/pipeline/cli.ts`, `app/api/crawl/route.ts`, `.env.example`  
**预估工时**: 1h

---

## 原因

### 当前不一致

| 入口 | 变量 | 默认值 | 说明 |
|---|---|---|---|
| `cli.ts` | `CRAWL_CONCURRENCY` | 10 | 命令行 |
| `route.ts` | `CRAWL_CONCURRENCY` | 10 | Web API |
| `cron.ts` | `MAX_CONCURRENT` | 2 | 定时任务 |

定时采集的并发数 (2) 远低于手动采集 (10)。这个差异在代码中被**硬编码**：

```typescript
// cron.ts:22
const MAX_CONCURRENT = 2;

// cli.ts:15
const CONCURRENCY = Number(process.env.CRAWL_CONCURRENCY ?? 10);

// route.ts:20
const CONCURRENCY = Number(process.env.CRAWL_CONCURRENCY ?? 10);
```

### 风险评估

- **混淆**：运维人员可能不理解为什么定时采集和手动采集速度差异巨大
- **不一致行为**：同一个环境变量的语义在不同入口不同（定时采集不理睬此变量）
- **Docker 内存压力**：定时任务默认为 2 是合理的（避免 Playwright 内存溢出），但手动触发默认为 10 可能导致 OOM

### 设计目标

1. 所有入口使用同一配置源
2. 定时任务默认低并发（适合无人值守），但可通过环境变量覆盖
3. 手动采集默认较高并发，同样可配置

---

## 详细修改步骤

### 步骤 1：定义配置常量

新建 `src/config/constants.ts`：

```typescript
/** 跨域名并行采集的默认并发数 */
export const DEFAULT_CRAWL_CONCURRENCY = 10;

/** 定时采集的默认并发数（低于手动采集，避免 Docker 内存溢出） */
export const DEFAULT_CRON_CONCURRENCY = 2;

/** 同域名内并行请求数 */
export const DEFAULT_PER_DOMAIN_CONCURRENCY = 3;

/** AI 审核并发数 */
export const DEFAULT_ANALYZE_CONCURRENCY = 3;

/** 每站最多抓取详情数 */
export const MAX_ITEMS_PER_SITE = 30;

/** 列表页抓取超时 (ms) */
export const LIST_FETCH_TIMEOUT_MS = 30000;

/** 详情页抓取超时 (ms) */
export const DETAIL_FETCH_TIMEOUT_MS = 30000;
```

### 步骤 2：所有入口读取同一配置

```typescript
// cli.ts - 命令行入口，允许用户指定
import { DEFAULT_CRAWL_CONCURRENCY } from "../config/constants";
const CONCURRENCY = Number(process.env.CRAWL_CONCURRENCY ?? DEFAULT_CRAWL_CONCURRENCY);
```

```typescript
// route.ts - Web API 入口
import { DEFAULT_CRAWL_CONCURRENCY } from "@/src/config/constants";
const CONCURRENCY = Number(process.env.CRAWL_CONCURRENCY ?? DEFAULT_CRAWL_CONCURRENCY);
```

```typescript
// cron.ts - 定时入口，使用专属环境变量（如果没有，回退到低默认值）
import { DEFAULT_CRON_CONCURRENCY } from "../config/constants";
const CONCURRENCY = Number(process.env.CRON_CONCURRENCY ?? DEFAULT_CRON_CONCURRENCY);
```

### 步骤 3：更新 `.env.example`

```bash
# ── 采集并发 ──
# 手动/Web API 触发的跨域名并行组数（默认 10）
CRAWL_CONCURRENCY=10
# 定时采集的跨域名并行组数（默认 2，避免 Playwright 内存溢出）
# CRON_CONCURRENCY=2
# 同域名内并行请求数（默认 3）
# CRAWL_PER_DOMAIN=3
```

### 步骤 4：添加启动时日志

让每次采集启动时明确输出使用的并发数：

```typescript
console.log(`并发=${CONCURRENCY} (${isCron ? '定时采集' : '手动采集'})`);
```

### 步骤 5：验证

1. `pnpm crawl` 使用 `CRAWL_CONCURRENCY` (默认 10)
2. POST `/api/crawl` 使用 `CRAWL_CONCURRENCY` (默认 10)
3. cron 定时采集使用 `CRON_CONCURRENCY` (默认 2)
4. 设置 `CRON_CONCURRENCY=5` 后 cron 使用 5

---

## 影响范围

| 影响 | 说明 |
|---|---|
| 配置可发现性 | 运维人员可明确理解各入口的并发行为 |
| 向后兼容 | 完全兼容，现有环境变量行为不变 |
| 代码变化 | 新增 1 个常量文件，修改 3 个文件的并发读取 |
