# S03: `runSite` 使用参数化查询代替全量加载

**关联分析**: [ANALYSIS.md](../ANALYSIS.md) → §8.1 短期改进

**优先级**: P1（重要）  
**涉及文件**: `src/pipeline/runner.ts`  
**预估工时**: 3h

---

## 原因

### 当前行为

```typescript
// src/pipeline/runner.ts:56-67
const existing = new Map<string, ExistingEntry>(
  db
    .select({
      url: schema.articles.url,
      id: schema.articles.id,
      siteId: schema.articles.siteId,
      hash: schema.articles.contentHash,
    })
    .from(schema.articles)
    .all()
    .map((r) => [r.url, { id: r.id, siteId: r.siteId, hash: r.hash ?? "" }]),
);
```

每次采集一个站点时，**将全库所有已入库文章的 URL/id/siteId/hash 加载到内存**。

### 数据增长分析

```
当前规模（87 站点，每站每天约 5-10 篇）：
  天产: ~500 篇
  年产: ~180,000 篇
  3 年: ~540,000 篇

Map 内存估算（每条约 200 bytes）：
  10 万条: ~20MB
  50 万条: ~100MB
```

`better-sqlite3` 是同步驱动，全表扫描 + 内存构建 Map 会阻塞事件循环。50 万条数据时，这个操作本身可能需要 2-5 秒（取决于磁盘性能）。

### 设计目标

用**精确 SQL 查询**替代全量加载：
1. 详情抓取前，对每批 URL 做 `SELECT ... WHERE url IN (...)` 精确查询
2. 保留 contentHash 变更检测逻辑

---

## 详细修改步骤

### 步骤 1：替换全量查询为精确查询

```typescript
// 删除原有的 existing Map 构建代码（行 56-67）
// 替换为辅助函数：

/** 批量查询已入库文章（按 URL 列表精确查询） */
function queryExisting(urls: string[]): Map<string, ExistingEntry> {
  if (!urls.length) return new Map();
  
  // better-sqlite3 不直接支持 WHERE IN 数组参数，需要构造占位符
  const placeholders = urls.map(() => "?").join(",");
  const stmt = sqlite.prepare(
    `SELECT url, id, site_id, content_hash FROM articles WHERE url IN (${placeholders})`
  );
  const rows = stmt.all(...urls) as Array<{
    url: string; id: number; site_id: number; content_hash: string | null;
  }>;
  
  const map = new Map<string, ExistingEntry>();
  for (const r of rows) {
    map.set(r.url, { id: r.id, siteId: r.site_id, hash: r.content_hash ?? "" });
  }
  return map;
}
```

### 步骤 2：修改需要查询的地方

采集到列表条目后，仅对这批 URL 精确查询：

```typescript
// 在切片 deduped.slice(0, MAX_ITEMS_PER_SITE) 之后，详情抓取之前：
const workItems = deduped.slice(0, MAX_ITEMS_PER_SITE);
const itemUrls = workItems.map(it => it.url);
const existing = queryExisting(itemUrls);
```

### 步骤 3：需要导入 sqlite 实例

`runner.ts` 目前通过 `db` 实例操作。需要从 `db/client.ts` 导出原始 `sqlite` 实例或使用 Drizzle 的 `inArray`：

```typescript
// 方案 A：使用 Drizzle 的 inArray（推荐，保持抽象一致性）
import { inArray } from "drizzle-orm";

function queryExisting(urls: string[]): Map<string, ExistingEntry> {
  if (!urls.length) return new Map();
  
  const rows = db
    .select({
      url: schema.articles.url,
      id: schema.articles.id,
      siteId: schema.articles.siteId,
      hash: schema.articles.contentHash,
    })
    .from(schema.articles)
    .where(inArray(schema.articles.url, urls))
    .all();
  
  return new Map(rows.map(r => [r.url, { id: r.id, siteId: r.siteId, hash: r.hash ?? "" }]));
}
```

### 步骤 4：处理边界情况

Drizzle 的 `inArray` 对空数组可能有不同行为：

```typescript
function queryExisting(urls: string[]): Map<string, ExistingEntry> {
  if (!urls.length) return new Map();
  const rows = db.select(...).from(...).where(inArray(schema.articles.url, urls)).all();
  return new Map(rows.map(r => [r.url, { id: r.id, siteId: r.siteId, hash: r.hash ?? "" }]));
}
```

### 步骤 5：验证

1. `pnpm crawl 1` 对单个站点采集，验证新文章正常入库
2. 对已采集过的站点再次采集，验证内容变更检测（contentHash 对比）正常
3. 跨站点 URL 冲突检测仍正常工作
4. 用一个有 1000+ 条文章的数据集对比修改前后的内存占用

---

## 影响范围

| 影响 | 说明 |
|---|---|
| 查询次数 | 从 1 次全局查询变为 N 次局部查询（N = 站点批次数）|
| 内存占用 | 从 O(全库) 降为 O(MAX_ITEMS_PER_SITE) ≈ 30条 |
| 响应延迟 | 取消全量加载的阻塞，Web 请求体验改善 |
| 行为兼容 | 完全兼容，不改变现有逻辑 |
