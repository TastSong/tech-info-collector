# 资讯流去重方案

## 问题

1. **采集时无基于内容的去重**：不同站点报道同一新闻（不同URL、相同内容）会被插入为独立文章
2. **资讯流无去重**：查询不做 `DISTINCT`/`GROUP BY`，相同内容的文章全部展示
3. **"已查看"不联动**：标记一篇为已读，相同内容的另一篇仍会出现在资讯流中

## 方案概述

**不改入库逻辑**（避免误判导致丢失内容），而是在**展示层**和**已查看联动**两个环节做基于 `contentHash` 的去重。

## 具体改动

### 1. `db/client.ts` — 添加 contentHash 索引

在初始化代码中添加：
```sql
CREATE INDEX IF NOT EXISTS idx_articles_content_hash ON articles(content_hash)
```

- 加速 `PARTITION BY content_hash` 和按 hash 查询
- `IF NOT EXISTS` 保证幂等

### 2. `app/feed/page.tsx` — 资讯流按 contentHash 去重

将当前 Drizzle 查询改为带窗口函数的 SQL：

```sql
SELECT * FROM (
  SELECT 
    a.id, a.title, a.fetched_at, a.published_at, a.site_id,
    s.name AS site_name, s.category,
    r.summary, r.headline,
    ROW_NUMBER() OVER (
      PARTITION BY COALESCE(a.content_hash, '#' || a.id)
      ORDER BY
        CASE WHEN r.id IS NOT NULL THEN 0 ELSE 1 END,
        COALESCE(a.published_at, a.fetched_at) DESC
    ) AS rn
  FROM articles a
  INNER JOIN sites s ON a.site_id = s.id
  LEFT JOIN ai_reviews r ON a.id = r.article_id
  WHERE a.viewed_at IS NULL
    AND a.status = 'published'
    AND (a.published_at >= ? OR (a.published_at IS NULL AND a.fetched_at >= ?))
) WHERE rn = 1
ORDER BY COALESCE(published_at, fetched_at) DESC
LIMIT 100
```

**去重策略**：
- `PARTITION BY COALESCE(content_hash, '#' || id)` — 有 hash 按 hash 分组；NULL hash 每篇独立
- `ORDER BY CASE WHEN r.id IS NOT NULL...` — 同组中优先选已有 AI 摘要的
- `ORDER BY COALESCE(published_at, fetched_at) DESC` — 同组中优先选最新的
- 外层 `WHERE rn = 1` 每组只保留一条

### 3. `app/api/articles/[id]/view/route.ts` — 已查看联动

标记一篇文章为已查看时，同时将**同 contentHash** 的其他文章也标记为已查看：

```typescript
// 获取当前文章的 contentHash
const article = db.select(...).where(eq(id)).get();

if (!article.viewedAt) {
  // 标记当前文章
  db.update(schema.articles)
    .set({ viewedAt: new Date() })
    .where(eq(schema.articles.id, Number(id)))
    .run();

  // 如果有 contentHash，联动标记同内容的文章
  if (article.contentHash) {
    db.update(schema.articles)
      .set({ viewedAt: new Date() })
      .where(
        and(
          eq(schema.articles.contentHash, article.contentHash),
          sql`${schema.articles.id} != ${Number(id)}`,
          sql`${schema.articles.viewedAt} IS NULL`
        )
      )
      .run();
  }
}
```

## 涉及文件

| 文件 | 改动 | 风险 |
|------|------|------|
| `db/client.ts` | 加一行 `CREATE INDEX IF NOT EXISTS` | 极低 |
| `app/feed/page.tsx` | 查询改用窗口函数去重 | 低，逻辑等价+去重 |
| `app/api/articles/[id]/view/route.ts` | 加联动更新 | 低，仅影响标记行为 |

## 不做的改动

- **入库时去重**：不在 `runner.ts` 的 `deduplicateAndSave` 中加跨URL去重。原因：若基于 hash 跳过，万一已有的那篇被 AI 判定为 `rejected`，我们就丢掉了这篇内容。展示层去重更安全。

## 边界情况

| 情况 | 处理 |
|------|------|
| 三篇相同hash，已查看一篇 | 联动标记另外两篇 → 三篇都不出现在资讯流 |
| 文章 contentHash 为 NULL | 各自独立，不去重（`'#' || id` 保证） |
| 同hash但一篇有AI摘要一篇没有 | 优先展示有摘要的那篇 |
| 新建站点还没跑过AI | articles 会入库，但没有 aiReviews，去重时优先展示更新那篇 |
