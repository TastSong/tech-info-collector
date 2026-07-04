# S05: 为 AI 审核添加事务包裹

**关联分析**: [ANALYSIS.md](../ANALYSIS.md) → §8.1 短期改进

**优先级**: P1（重要）  
**涉及文件**: `src/ai/analyze.ts`  
**预估工时**: 2h

---

## 原因

### 当前行为

```typescript
// src/ai/analyze.ts:53-85（简化）
// 步骤 1: UPDATE status='analyzing'
db.update(schema.articles).set({ status: "analyzing" })...

// 步骤 2: 调用 LLM（外部调用，可能耗时 5-30s）

// 步骤 3: INSERT ai_reviews
db.insert(schema.aiReviews).values({...}).run();

// 步骤 4: UPDATE status='published'|'rejected'
db.update(schema.articles).set({ status })...
```

四步操作分属四次独立的数据库写入，不在事务中。

### 风险场景

```
时间线：
  T1: UPDATE status='analyzing'  ✓
  T2: LLM 调用中...
  T3: 进程崩溃 / Docker restart    ← 此时状态='analyzing'，无 review 记录
  T4: 重启后 → 文章状态仍为 'analyzing'，永远不会再被审核
```

另一个场景：
```
  T1: UPDATE status='analyzing'  ✓
  T2: LLM 调用成功，返回结果
  T3: INSERT ai_reviews  ✓
  T4: UPDATE status → 崩溃        ← 状态未更新，但 review 已写入
  T5: 重启后 → 文章状态='analyzing'，但有孤儿 review 记录
```

### 设计目标

将 INSERT review + UPDATE status 包装在数据库事务中，保证原子性。
由于 LLM 调用是耗时外部操作，不能放在事务内。但 **LLM 调用之后**的数据写入必须是原子的。

---

## 详细修改步骤

### 步骤 1：理解 SQLite 事务模型

`better-sqlite3` 的同步 API 天然适合事务：

```typescript
const tx = db.transaction(() => {
  db.insert(...).run();
  db.update(...).run();
});
tx(); // 同步执行，要么全部成功，要么全部回滚
```

注意：`db`（Drizzle 实例）和 `sqlite`（原始 better-sqlite3 实例）有不同的 API。

### 步骤 2：修改 analyze.ts 中的写入逻辑

```typescript
// 在 analyzePending 函数的 queue.add 回调中

// 步骤 1: 标记 analyzing（这个可以在事务外，因为如果崩溃只是丢失一次审核机会）
db.update(schema.articles)
  .set({ status: "analyzing" })
  .where(eq(schema.articles.id, a.id))
  .run();

try {
  const r = await reviewArticle({...});
  const status = decideStatus(r);
  
  // 步骤 2-3: 使用事务原子写入 review + status
  db.transaction(() => {
    db.insert(schema.aiReviews).values({
      articleId: a.id,
      model: r.model,
      relevant: r.relevant,
      summary: r.summary,
      headline: r.headline,
      keyPoints: r.keyPoints,
      tags: r.tags,
      qualityScore: r.qualityScore,
      isNews: r.isNews,
      newsScore: r.newsScore,
      usable: r.usable,
      reason: r.reason,
      tokensUsed: r.tokens,
    }).run();
    
    db.update(schema.articles)
      .set({ status })
      .where(eq(schema.articles.id, a.id))
      .run();
  })();
  
  tokens += r.tokens;
  if (status === "published") published++;
  else rejected++;
} catch (e) {
  errored++;
  // 失败时也使用事务
  db.transaction(() => {
    db.insert(schema.aiReviews).values({
      articleId: a.id,
      model: process.env.AI_MODEL!,
      usable: false,
      qualityScore: 0,
      isNews: false,
      newsScore: 0,
      reason: `[审核失败] ${(e as Error).message.slice(0, 180)}`,
      tokensUsed: 0,
    }).run();
    
    db.update(schema.articles)
      .set({ status: "rejected" })
      .where(eq(schema.articles.id, a.id))
      .run();
  })();
}
```

### 步骤 3：处理 Drizzle 事务 API

Drizzle ORM 的 `db.transaction()` 返回方式需要确认：

```typescript
// Drizzle + better-sqlite3 的事务 API
const result = db.transaction((tx) => {
  // tx 是事务内的 db 实例
  tx.insert(schema.aiReviews).values({...}).run();
  tx.update(schema.articles).set({...}).where(...).run();
  return "ok";
});
// result === "ok"
```

### 步骤 4：处理异常回滚

如果事务内抛出异常，Drizzle 自动回滚：

```typescript
try {
  db.transaction(() => {
    db.insert(schema.aiReviews).values({...}).run();
    // 如果此处抛异常，insert 会被回滚
    db.update(schema.articles).set({...}).run();
  })();
} catch (txError) {
  // 事务已回滚，文章状态保持 'analyzing'
  // 下一轮 analyzePending 会重新处理
  console.log(`  ! #${a.id} 事务失败，等待下一轮重试`);
}
```

### 步骤 5：恢复 analyzing 文章的清理

添加一个预处理：在开始审核前，将长时间卡在 `analyzing` 状态（超过 30 分钟）的文章恢复为 `raw`：

```typescript
// analyzePending 开头添加：
const STALE_THRESHOLD_MS = 30 * 60 * 1000;
const staleCutoff = new Date(Date.now() - STALE_THRESHOLD_MS);

db.update(schema.articles)
  .set({ status: "raw" })
  .where(
    and(
      eq(schema.articles.status, "analyzing"),
      lte(schema.articles.fetchedAt, staleCutoff)  // fetchedAt 作为参考时间
    )
  )
  .run();
```

这样可以确保上次崩溃残留的 `analyzing` 文章能被重新排队审核。

### 步骤 6：验证

1. 正常审核流程不受影响
2. 模拟事务内异常（临时改错表名），确认 insert 被回滚
3. 确认 analyzing 清理逻辑生效
4. 确认统计计数正确（published/rejected/errored）

---

## 影响范围

| 影响 | 说明 |
|---|---|
| 数据一致性 | 显著提升：review + status 原子写入 |
| 恢复能力 | analyzing 文章可自动恢复为 raw |
| 性能 | 事务开销可忽略（SQLite 本地操作） |
| 代码变化 | 最小（仅调整写入顺序，包裹事务） |
