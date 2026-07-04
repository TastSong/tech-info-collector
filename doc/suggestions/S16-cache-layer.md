# S16: 引入缓存层

**关联分析**: [ANALYSIS.md](../ANALYSIS.md) → §8.3 长期改进

**优先级**: L3（架构级）  
**涉及文件**: 新建 `src/lib/cache.ts`, 修改各页面  
**预估工时**: 6h

---

## 原因

### 当前行为

所有页面都使用 `force-dynamic`（即 SSR，每次请求都重新渲染 + DB 查询）：

```typescript
// 每个页面顶部
export const dynamic = "force-dynamic";
```

这导致：
- **重复查询**：仪表盘每次刷新都查询 sites、articles、crawlSessions、runLogs
- **无 CDN 缓存**：force-dynamic 禁用了 Next.js 的所有缓存层
- **不必要的负载**：站点列表、统计数据等变化缓慢的数据频繁查询

### 设计目标

引入内存缓存层，对变化频率低的查询结果进行缓存。使用 Next.js 的 `unstable_cache` 或自建 TTL 缓存。

---

## 详细修改步骤

### 步骤 1：创建 TTL 缓存

新建 `src/lib/cache.ts`：

```typescript
interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const store = new Map<string, CacheEntry<unknown>>();

// 每 5 分钟清理过期条目
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (now > entry.expiresAt) store.delete(key);
  }
}, 5 * 60 * 1000).unref();

/**
 * 带 TTL 的缓存包装
 */
export async function cached<T>(
  key: string,
  ttlMs: number,
  fn: () => Promise<T>,
): Promise<T> {
  const now = Date.now();
  const entry = store.get(key) as CacheEntry<T> | undefined;

  if (entry && now < entry.expiresAt) {
    return entry.data;
  }

  const data = await fn();
  store.set(key, { data, expiresAt: now + ttlMs });
  return data;
}

/** 手动使缓存失效 */
export function invalidate(key: string): void {
  store.delete(key);
}

/** 按前缀使缓存失效 */
export function invalidatePrefix(prefix: string): void {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}
```

### 步骤 2：在页面中使用缓存

```typescript
// app/page.tsx（仪表盘）
import { cached } from "@/src/lib/cache";

export default async function Home() {
  // 统计数据缓存 30 秒
  const stats = await cached("dashboard:stats", 30_000, async () => {
    const articles = db.select().from(schema.articles).all();
    return {
      total: articles.length,
      published: articles.filter(a => a.status === "published").length,
      rejected: articles.filter(a => a.status === "rejected").length,
    };
  });

  // 站点概况缓存 2 分钟
  const siteStats = await cached("dashboard:siteStats", 120_000, async () => {
    return db.select({...}).from(schema.sites).leftJoin(...).groupBy(...).all();
  });

  // 最近采集缓存 10 秒（变化较快）
  const sessions = await cached("dashboard:sessions", 10_000, async () => {
    return db.select().from(schema.crawlSessions).orderBy(desc(...)).limit(5).all();
  });

  return <HomePage stats={stats} siteStats={siteStats} sessions={sessions} />;
}
```

### 步骤 3：在数据变更时失效缓存

```typescript
// 采集完成后
import { invalidatePrefix } from "@/src/lib/cache";

// 在 runCrawl 完成时
invalidatePrefix("dashboard:");
invalidatePrefix("articles:");
invalidatePrefix("sites:");

// 在 AI 审核完成后
invalidatePrefix("feed:");
invalidatePrefix("articles:");
```

### 步骤 4：缓存 Feed 数据

```typescript
// app/feed/page.tsx
export default async function FeedPage() {
  // Feed 缓存 1 分钟（文章审核后可能新增）
  const rows = await cached("feed:latest", 60_000, async () => {
    return db.select({...}).from(...).innerJoin(...).leftJoin(...).where(...).all();
  });
  // ...
}
```

### 步骤 5：可选——使用 Next.js ISR

对于变化极慢的页面（如站点配置 `/sites`），可考虑 `revalidate` 替代 `force-dynamic`：

```typescript
// app/sites/page.tsx
// 替代 export const dynamic = "force-dynamic";
export const revalidate = 60; // 每 60 秒 ISR
```

但这要求将 `db` 查询也适配异步模式，仅适用于 S14（PostgreSQL 迁移）之后。

### 步骤 6：缓存监控

添加缓存统计 API：

```typescript
// app/api/cache/stats/route.ts
export async function GET() {
  return NextResponse.json({
    size: store.size,
    keys: [...store.keys()].slice(0, 50), // 截断
  });
}
```

### 步骤 7：验证

1. 仪表盘首次访问 → 正常 DB 查询
2. 30 秒内再次访问 → 命中缓存，无 DB 查询
3. 触发采集 → 仪表盘统计自动刷新（缓存失效）
4. Feed 缓存正常

---

## 影响范围

| 影响 | 说明 |
|---|---|
| 页面响应 | 命中缓存时 <5ms（无 DB 查询） |
| 数据新鲜度 | 有 TTL 延迟（30s-120s 可接受） |
| 内存消耗 | ~KB 级别（缓存少量的统计数据） |
| 多副本 | 内存缓存不共享，每个副本独立 |
