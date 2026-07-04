# S14: 迁移到 PostgreSQL

**关联分析**: [ANALYSIS.md](../ANALYSIS.md) → §8.3 长期改进

**优先级**: L1（架构级）  
**涉及文件**: 全项目（数据库层）  
**预估工时**: 16-24h

---

## 原因

### 当前约束

SQLite 带来的根本性限制：

| 限制 | 具体影响 |
|---|---|
| **同步 IO 阻塞** | 每次 DB 查询阻塞 Node.js 事件循环，高并发时 Web 响应变慢 |
| **单写入者** | WAL 模式允许一写多读，但仍串行写入；多站点采集时成为瓶颈 |
| **不支持多副本** | 单机数据库，无法水平扩展。如果部署多个容器副本，各有独立的 DB 文件 |
| **无连接池** | better-sqlite3 只有一个连接，所有操作排队 |
| **无原生 JSON 查询** | `urls`, `keyPoints`, `tags` 存为 JSON 文本，无法在 SQL 层做高效查询 |
| **Schema 变更风险** | ALTER TABLE 在 SQLite 中功能受限（如无法 DROP COLUMN） |

### 为什么现在是时候

项目规模增长（87 站点、每日 500+ 新文章、30万+ 年文章数），SQLite 的同步阻塞问题会越来越严重。当前架构已使用 Drizzle ORM（支持 PostgreSQL），迁移成本可控。

### 设计目标

保持 Drizzle ORM 不变，将数据库从 SQLite 切换到 PostgreSQL（可通过 Docker Compose 添加 PostgreSQL 容器）。

---

## 详细修改步骤

### 步骤 1：添加 PostgreSQL 依赖

```bash
pnpm add pg drizzle-orm  # pg 已存在，drizzle-orm 已安装
pnpm add -D @types/pg
```

### 步骤 2：修改数据库客户端

重写 `db/client.ts`：

```typescript
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const pool = new Pool({
  host: process.env.DB_HOST ?? "localhost",
  port: Number(process.env.DB_PORT ?? 5432),
  database: process.env.DB_NAME ?? "tech_info_collector",
  user: process.env.DB_USER ?? "postgres",
  password: process.env.DB_PASSWORD ?? "postgres",
  max: 10, // 连接池大小
  idleTimeoutMillis: 30000,
});

export const db = drizzle(pool, { schema });
export { schema };
```

### 步骤 3：调整 Drizzle 配置

```typescript
// drizzle.config.ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dbCredentials: {
    host: process.env.DB_HOST ?? "localhost",
    port: Number(process.env.DB_PORT ?? 5432),
    database: process.env.DB_NAME ?? "tech_info_collector",
    user: process.env.DB_USER ?? "postgres",
    password: process.env.DB_PASSWORD ?? "postgres",
  },
});
```

### 步骤 4：调整 Schema 类型

SQLite 和 PostgreSQL 的 Drizzle schema 差异：

| SQLite | PostgreSQL | 修改 |
|---|---|---|
| `sqliteTable("name", {...})` | `pgTable("name", {...})` | 全局替换 |
| `integer("id", { mode: "timestamp" })` | `timestamp("created_at")` | 时间字段 |
| `text("status", { enum: [...] })` | `pgEnum("status", [...])` → `text("status")` | 枚举改用 text + check |
| `integer("enabled", { mode: "boolean" })` | `boolean("enabled")` | 布尔字段 |
| `text("urls", { mode: "json" })` | `jsonb("urls")` | JSON 字段 |
| `sql`(unixepoch())`` | `sql`now()`` | 默认值 |

优化后的 schema 示例：

```typescript
import { pgTable, text, integer, real, boolean, jsonb, timestamp, serial } from "drizzle-orm/pg-core";

export const sites = pgTable("sites", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  category: text("category"),
  subcategory: text("subcategory"),
  urls: jsonb("urls").$type<string[]>().notNull().default([]),
  render: text("render").notNull().default("static"),
  listSelector: text("list_selector"),
  // ...
  enabled: boolean("enabled").notNull().default(true),
  lastRunAt: timestamp("last_run_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
```

### 步骤 5：修改 db/client.ts 导出的模式

由于 SQLite 同步 API 和 PostgreSQL 异步 API 完全不同，需要修改所有调用方：

**之前（SQLite 同步）**:
```typescript
const sites = db.select().from(schema.sites).all();
```

**之后（PostgreSQL 异步）**:
```typescript
const sites = await db.select().from(schema.sites);
```

这是迁移中最耗时的部分——需要将所有 DB 操作改为 async/await。

### 步骤 6：数据迁移

创建数据迁移脚本 `scripts/migrate-to-pg.ts`：

```typescript
import Database from "better-sqlite3";
import { Pool } from "pg";
import path from "node:path";

async function migrate() {
  const sqlite = new Database(path.resolve("data/collector.db"));
  const pg = new Pool({...});
  
  // 1. 从 SQLite 读取所有数据
  const sites = sqlite.prepare("SELECT * FROM sites").all();
  const articles = sqlite.prepare("SELECT * FROM articles").all();
  const aiReviews = sqlite.prepare("SELECT * FROM ai_reviews").all();
  const runLogs = sqlite.prepare("SELECT * FROM run_logs").all();
  const crawlSessions = sqlite.prepare("SELECT * FROM crawl_sessions").all();
  const settings = sqlite.prepare("SELECT * FROM settings").all();
  
  // 2. 写入 PostgreSQL（使用事务）
  const client = await pg.connect();
  try {
    await client.query("BEGIN");
    
    for (const site of sites) {
      await client.query(
        "INSERT INTO sites (...) VALUES (...)",
        [...]
      );
    }
    // ... 其他表
    
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
```

### 步骤 7：更新 Docker Compose

```yaml
services:
  app:
    build: .
    # ... 现有配置
    environment:
      - DB_HOST=postgres
      - DB_PORT=5432
      - DB_NAME=tech_info_collector
      - DB_USER=postgres
      - DB_PASSWORD=${DB_PASSWORD:-postgres}
    depends_on:
      postgres:
        condition: service_healthy

  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: tech_info_collector
      POSTGRES_PASSWORD: ${DB_PASSWORD:-postgres}
    volumes:
      - pg_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD", "pg_isready", "-U", "postgres"]
      interval: 10s
      retries: 5

volumes:
  pg_data:
  collector_data: # 保留旧数据卷用于迁移
```

### 步骤 8：Next.js 适配

Next.js 中 PostgreSQL 的异步调用需要确保在 Server Components 和 API Routes 中正确处理：

```typescript
// 页面组件改为 async
export default async function Home() {
  const sites = await db.select().from(schema.sites);
  // ...
}
```

Server Components 天然支持 async，这是优势；但 `layout.tsx` 中不能直接 await（需通过 `cookies()` 等间接方式）。

### 步骤 9：验证

1. API 响应正常
2. 采集 + AI 审核流程完整
3. 并发性能测试（10 个并发请求）
4. 数据迁移完整性（行数一致）
5. Docker Compose 一键启动

---

## 影响范围

| 影响 | 说明 |
|---|---|
| 文件变更 | 几乎所有含 DB 操作的文件（~30 个文件） |
| 性能提升 | 异步 IO 不再阻塞事件循环，连接池支持高并发 |
| 多副本 | 支持水平扩展 |
| 运维复杂度 | 增加 PostgreSQL 容器的运维需求 |
| 风险 | 大型迁移，需充分测试和回滚方案 |
