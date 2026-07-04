# S11: 数据库迁移规范化

**关联分析**: [ANALYSIS.md](../ANALYSIS.md) → §8.2 中期改进

**优先级**: M3  
**涉及文件**: `scripts/init-db.cjs`, `scripts/build-init-db.cjs`, `db/schema.ts`, `drizzle.config.ts`  
**预估工时**: 4h

---

## 原因

### 当前行为

数据库 schema 创建/migration 使用 `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE ... ADD COLUMN` + try/catch 的模式：

```javascript
// scripts/init-db.cjs
db.exec(`CREATE TABLE IF NOT EXISTS sites (...)`);

// 幂等添加列
try {
  db.exec(`ALTER TABLE run_logs ADD COLUMN crawl_session_id INTEGER REFERENCES crawl_sessions(id)`);
} catch (e) {
  if (!e.message.includes('duplicate column name')) {
    console.error('ALTER TABLE run_logs failed:', e.message);
  }
}
```

这种模式的问题：
- **不可回滚**：出错后状态不确定
- **无版本追踪**：不知道数据库当前处于哪个 schema 版本
- **初始化逻辑分散**：三处有 schema 定义（`schema.ts`, `init-db.cjs`, `build-init-db.cjs`）
- **无法处理复杂变更**：如重命名列、修改约束等，try/catch 无法处理
- **CI/部署风险**：如果 ALTER TABLE 中途失败，数据库处于损坏状态

### 设计目标

使用 Drizzle Kit 原生的 `drizzle-kit push`/`drizzle-kit migrate` 来管理 schema 变更。

---

## 详细修改步骤

### 步骤 1：生成初始迁移

```bash
# 确保 schema.ts 是当前数据库的正确定义
pnpm drizzle-kit generate
```

这会在 `db/migrations/` 下生成 SQL 迁移文件。

### 步骤 2：创建迁移运行脚本

新建 `src/lib/migrate.ts`：

```typescript
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "node:path";
import fs from "node:fs";

const dbPath = path.resolve(process.cwd(), "data/collector.db");
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const sqlite = new Database(dbPath);
sqlite.pragma("journal_mode = WAL");

const db = drizzle(sqlite);

// 执行迁移
migrate(db, {
  migrationsFolder: path.resolve(process.cwd(), "db/migrations"),
});

console.log("[migrate] 数据库迁移完成");
sqlite.close();
```

### 步骤 3：修改 entrypoint/db init 脚本

```javascript
// scripts/init-db.cjs → 改为调用 drizzle-kit migrate
const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const dbPath = path.join(process.cwd(), "data/collector.db");
const dir = path.dirname(dbPath);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

// 使用 Drizzle Kit 的迁移命令
try {
  execSync("npx drizzle-kit migrate", {
    stdio: "inherit",
    env: { ...process.env },
  });
  console.log("[init] 数据库迁移完成");
} catch (e) {
  console.error("[init] 迁移失败:", e.message);
  process.exit(1);
}
```

### 步骤 4：同步 `db/schema.ts` 与迁移文件

确保 `db/schema.ts` 是 schema 的**唯一定义源**。删除 `init-db.cjs` 和 `build-init-db.cjs` 中的原始 SQL CREATE TABLE 语句。

### 步骤 5：添加迁移回滚脚本（可选）

```bash
# 添加到 package.json
"db:rollback": "tsx scripts/rollback-migration.ts"
```

### 步骤 6：更新 Dockerfile

```dockerfile
# 在 runner 阶段添加
COPY --from=builder /app/db/migrations ./db/migrations
```

entrypoint 中只需要执行 `node scripts/init-db.cjs`（内部调用 drizzle-kit migrate）。

### 步骤 7：验证

1. 全新部署（无 DB 文件）→ 自动创建所有表
2. 已有数据库升级 → 仅执行增量迁移
3. 迁移失败 → 清晰的错误信息
4. 幂等性：多次运行不报错

---

## 影响范围

| 影响 | 说明 |
|---|---|
| schema 变更流程 | 从"手动写 SQL + try/catch"变为"修改 schema.ts + generate + migrate" |
| 文件变更 | 删除 init-db.cjs 中的 CREATE TABLE，新增 db/migrations/ |
| 部署流程 | `docker compose up -d --build` 不变 |
| 回滚能力 | 新增（通过 drizzle-kit drop） |
