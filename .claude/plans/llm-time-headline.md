# 计划：LLM 分析增加时间分析 + 资讯流标题由 LLM 生成

## 变更概览

两个核心改动：

1. **LLM 分析时加入时间维度** — 将文章的发布时间传递给 LLM，让它在评分时考虑时效性
2. **资讯流标题改为 LLM 生成的标题** — 新增 `headline` 字段，feed 卡片展示 AI 生成的短标题而非原始页面标题

---

## 1. 数据库变更

### `ai_reviews` 表新增字段

```sql
headline TEXT  -- LLM 生成的短标题（≤30字），用于资讯流展示
```

- 通过 `pnpm db:push` 推送到 SQLite（Drizzle 自动处理）

---

## 2. Schema 变更

### `db/schema.ts`
- 在 `aiReviews` 表中新增 `headline: text("headline")`

### `src/ai/schemas.ts`
- `reviewSchema` 新增 `headline: z.string().describe("≤30字短标题，用于资讯流展示，应提炼核心信息")`

---

## 3. LLM Prompt 变更

### `src/ai/sandbox.ts`

**输入侧：**
- `reviewArticle` 新增 `publishedAt: Date | null` 参数
- user prompt 中新增发布时间行：
  ```
  发布时间：2024-01-05（如无则为"未知"）
  ```

**系统 prompt 更新：**
- 增加 `headline` 字段说明
- 强调时效性对 qualityScore 的影响（陈年旧闻降分、最新动态加分）
- 判定规则中增加时效维度

**输出侧：**
- `ReviewResult` 类型新增 `headline: string`

---

## 4. 分析调用链变更

### `src/ai/analyze.ts`
- 调用 `reviewArticle` 时传入 `publishedAt: a.publishedAt`

---

## 5. 前端展示变更

### `app/feed/page.tsx`
- SELECT 查询新增 `aiReviews.headline`
- 传给 FeedCard 的数据增加 `headline` 字段

### `app/components/FeedCard.tsx`
- 标题区域优先展示 `headline`（AI 生成的短标题），fallback 到原始 `title`
- 原始 `title` 降级为副标题（小字显示在 headline 下方，如有）

### `app/articles/[id]/page.tsx`
- AI 审核面板中展示 `headline` 字段

---

## 实施步骤

1. 修改 `db/schema.ts` — 新增 `headline` 列
2. 运行 `pnpm db:push` 推送 schema 变更
3. 修改 `src/ai/schemas.ts` — 新增 `headline` 字段
4. 修改 `src/ai/sandbox.ts` — 更新 prompt + 传入 publishedAt + 输出 headline
5. 修改 `src/ai/analyze.ts` — 传入 publishedAt
6. 修改 `app/feed/page.tsx` — 查询 headline
7. 修改 `app/components/FeedCard.tsx` — 展示 headline
8. 修改 `app/articles/[id]/page.tsx` — 展示 headline
9. Docker 构建部署测试
