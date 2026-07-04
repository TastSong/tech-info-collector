# 去除人工复核，LLM直接打分过滤

## 改动概览

将当前的"LLM打分 → 灰区人工复核 → 发布"三态流程，改为"LLM直接打分 → 阈值过滤 → 自动发布/驳回"的二态流程。

---

## 1. 数据库 Schema (`db/schema.ts`)

- articles.status 枚举从 `["raw", "analyzing", "ready", "rejected", "review", "published"]` 改为 `["raw", "analyzing", "published", "rejected"]`
- 移除 "ready" 和 "review" 状态

## 2. `decideStatus()` 重构 (`src/ai/sandbox.ts`)

- 从三态 `"ready" | "rejected" | "review"` 改为二态 `"published" | "rejected"`
- 移除 `AI_REVIEW_LOW` / `AI_REVIEW_HIGH` 双阈值灰区逻辑
- 使用单一阈值 `AI_PUBLISH_THRESHOLD`（默认 0.5）
- 规则：`!isNews || !usable || qualityScore < threshold → rejected`，否则 → `published`
- 移除 `relevant` 判断（之前不相关→review，现在不相关直接 rejected）

## 3. LLM分析 Pipeline (`src/ai/analyze.ts`)

- 移除 `review` 计数器
- 错误处理：失败文章 status 从 `"review"` 改为 `"rejected"`
- 更新日志输出

## 4. API 路由

- **删除** `app/api/articles/[id]/route.ts` — 审批 approve/reject 接口不再需要

## 5. 前端页面

- **删除** `app/review/page.tsx` — 人工复核页面
- `app/page.tsx` (仪表盘) — 移除 review 统计，更新文案
- `app/articles/page.tsx` — 状态筛选移除 "review"/"ready"，新增 "published"
- `app/feed/page.tsx` — 查询条件从 `status="ready"` 改为 `status="published"`

## 6. 前端组件

- `app/components/NavLinks.tsx` — 移除 "待复核" 导航链接和 reviewCount
- `app/layout.tsx` — 移除 reviewCount 查询
- `app/components/Badges.tsx` — 移除 "review" case，"ready" 替换为 "published"
- `app/components/ActionButtons.tsx` — 移除 `ArticleActions` 组件（审批按钮）
- `app/articles/[id]/page.tsx` — 移除 ArticleActions 引用

## 7. 环境变量

- `.env` / `.env.example` — 移除 `AI_REVIEW_LOW` / `AI_REVIEW_HIGH`，添加 `AI_PUBLISH_THRESHOLD=0.5`

## 8. 数据迁移

需要在部署时执行一次性 SQL 迁移：
```sql
UPDATE articles SET status='rejected' WHERE status='review';
UPDATE articles SET status='published' WHERE status='ready';
```
