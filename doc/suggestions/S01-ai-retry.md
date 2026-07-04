# S01: 添加 AI 审核失败重试机制

**关联分析**: [ANALYSIS.md](../ANALYSIS.md) → §8.1 短期改进

**优先级**: P0（高优先）  
**涉及文件**: `src/ai/analyze.ts`  
**预估工时**: 4h

---

## 原因

### 当前行为

```typescript
// src/ai/analyze.ts:93-103
catch (e) {
  errored++;
  db.update(schema.articles)
    .set({ status: "rejected" })
    .where(eq(schema.articles.id, a.id))
    .run();
}
```

LLM API 调用失败时（超时、限流 429、网络故障、JSON 解析失败），**直接标记文章为 `rejected`，无任何重试**。

### 风险评估

- **数据损失**：LLM 服务不稳定时段，所有待审核文章会被错误驳回。以当前 87 个启用的站点估算，一次批量采集可能产生 200+ 篇待审核文章，API 偶发故障可导致全量误驳回。
- **静默失败**：用户可能不知道有多少文章是因审核失败而被驳回的（日志只输出到 console）。
- **不可恢复**：一旦标记为 `rejected`，没有机制重新排队审核。

### 设计目标

1. 可重试错误（网络超时、5xx、429）→ 指数退避重试 3 次
2. 不可重试错误（API key 错误、模型不存在）→ 仍标记为 rejected 并记录失败原因
3. 重试耗尽后 → 标记为 rejected，**独立**失败原因字段，区分于正常审核驳回
4. 不改变现有并发模型和事务边界

---

## 详细修改步骤

### 步骤 1：识别可重试错误

在 `src/ai/sandbox.ts` 中导出错误分类函数：

```typescript
// 新增文件末尾
export function isRetryableError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  // 5xx 服务端错误
  if (/5\d\d/.test(msg)) return true;
  // 429 rate limit
  if (/429/.test(msg)) return true;
  // 网络超时
  if (/timeout|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|fetch failed/i.test(msg)) return true;
  // JSON 解析失败 (模型输出格式问题，重试可能得到正确输出)
  if (/未找到 JSON 对象|JSON|schema 校验失败/i.test(msg)) return true;
  return false;
}
```

### 步骤 2：抽取重试逻辑

在 `src/ai/analyze.ts` 中修改单篇文章审核流程：

```typescript
// 新增导入
import { reviewArticle, decideStatus, isRetryableError } from "./sandbox";

// 在 analyzePending 函数内部，替换 queue.add 中的 catch 块

const MAX_RETRIES = 3;

// 审核文章（带重试）
async function reviewWithRetry(row: {...}): Promise<{status: "published"|"rejected"|"error", tokens: number}> {
  let lastErr: unknown;
  
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      // 指数退避：2s, 4s, 8s
      const delay = Math.min(2000 * 2 ** (attempt - 1), 10000);
      console.log(`  ↻ #${row.a.id} 重试 ${attempt}/${MAX_RETRIES}，等待 ${delay}ms`);
      await new Promise(r => setTimeout(r, delay));
    }
    
    try {
      const r = await reviewArticle({
        title: row.a.title ?? "",
        body: row.a.body ?? "",
        scope: row.s.scope,
        publishedAt: row.a.publishedAt,
      });
      const status = decideStatus(r);
      
      db.insert(schema.aiReviews).values({
        articleId: row.a.id,
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
      
      return { status, tokens: r.tokens };
    } catch (e) {
      lastErr = e;
      if (!isRetryableError(e) || attempt >= MAX_RETRIES) {
        throw e;
      }
    }
  }
  throw lastErr;
}
```

### 步骤 3：更新 queue.add 使用新逻辑

```typescript
// 删除原有的 reviewArticle + decideStatus + db.insert 代码块
// 替换为：

const result = await reviewWithRetry(row);

// 成功后的状态更新
db.update(schema.articles)
  .set({ status: result.status })
  .where(eq(schema.articles.id, a.id))
  .run();

tokens += result.tokens;
if (result.status === "published") published++;
else rejected++;
```

### 步骤 4：失败时记录原因

catch 块中区分重试耗尽 vs 不可重试：

```typescript
} catch (e) {
  errored++;
  const errMsg = (e as Error).message.slice(0, 200);
  
  // 插入一条空 review 记录失败原因
  db.insert(schema.aiReviews).values({
    articleId: a.id,
    model: process.env.AI_MODEL!,
    usable: false,
    qualityScore: 0,
    isNews: false,
    newsScore: 0,
    reason: `[审核失败] ${errMsg}`,
    tokensUsed: 0,
  }).run();
  
  db.update(schema.articles)
    .set({ status: "rejected" })
    .where(eq(schema.articles.id, a.id))
    .run();
  
  console.log(`  ! #${a.id} 失败→rejected (重试${MAX_RETRIES}次后): ${errMsg}`);
}
```

### 步骤 5：验证

1. 模拟网络错误（临时改错 `AI_BASE_URL`）
2. 确认 `errored` 计数正确
3. 确认重试日志输出正常
4. 确认 `rejected` 文章有对应的 ai_reviews 记录且 reason 以 `[审核失败]` 开头

---

## 影响范围

| 影响 | 说明 |
|---|---|
| 执行时间 | 失败时增加 2s→4s→8s 等待，单篇最坏增加 14s |
| 数据库 | `ai_reviews` 新增失败记录（之前失败不回写 review） |
| 内存 | 无影响 |
| 兼容性 | 向后兼容，不改变 API 接口 |
