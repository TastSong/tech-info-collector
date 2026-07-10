# 资讯流页面优化分析报告

> **分析日期**: 2026-07-09  
> **分析范围**: `/app/feed`, `/app/components/FeedCard`, `/app/articles/[id]`, `/api/articles/[id]/view`, `/src/pipeline/dedup`, `/src/pipeline/runner`, `/src/ai/intelligent-crawl`, `/db/schema`
> **分析方法**: 逐文件阅读全部源码，追踪数据流从前端展示→API→数据库查询→采集管道，分析架构、性能、UX、代码质量四个维度

---

## 目录

1. [架构全景](#1-架构全景)
2. [性能瓶颈分析](#2-性能瓶颈分析)
3. [用户体验缺陷](#3-用户体验缺陷)
4. [信息架构问题](#4-信息架构问题)
5. [代码质量问题](#5-代码质量问题)
6. [数据模型考量](#6-数据模型考量)
7. [移动端适配](#7-移动端适配)
8. [优化建议优先级矩阵](#8-优化建议优先级矩阵)
9. [详细实施方案](#9-详细实施方案)

---

## 1. 架构全景

### 1.1 当前数据流

```
用户访问 /feed
    ↓
Server Component (app/feed/page.tsx)
    ↓ 原始 SQL (db.all)
    ├─ articles 表 (viewed_at IS NULL, status='published', 近15天)
    ├─ ROW_NUMBER() OVER (PARTITION BY content_hash) — 去重
    ├─ JOIN sites (site name, category)
    ├─ LEFT JOIN ai_reviews (headline, summary)
    ├─ LIMIT 100
    ↓
按 category 分组 → 渲染 FeedCard 组件列表
    ↓
用户点击"已阅读"
    ↓
POST /api/articles/[id]/view
    ├─ 设置 viewed_at = now
    └─ 级联更新同 content_hash 的文章
用户点击 FeedCard → /articles/[id]?from=feed
    ↓
MarkViewed 组件自动标记已读
```

### 1.2 关键文件清单

| 文件 | 职责 | 行数 |
|------|------|------|
| `app/feed/page.tsx` | 服务端组件，数据查询+分组+渲染 | 135 |
| `app/components/FeedCard.tsx` | 客户端卡片，"已阅读"按钮 | 76 |
| `app/articles/[id]/page.tsx` | 文章详情+AI审核面板 | 203 |
| `app/components/MarkViewed.tsx` | 从feed进入时自动标记已读 | 25 |
| `app/api/articles/[id]/view/route.ts` | 标记已读API，含content_hash级联 | 55 |
| `src/pipeline/dedup.ts` | SHA1内容指纹(16位) | 8 |
| `src/pipeline/runner.ts` | 采集编排，去重+写入 | 188 |
| `db/schema.ts` | 全库schema (articles/aiReviews/sites/runLogs) | 138 |

---

## 2. 性能瓶颈分析

### 2.1 数据库查询问题

#### 问题 2.1.1: 原始SQL绕过ORM类型安全

**位置**: `app/feed/page.tsx:27-64`

```typescript
const rawRows = db.all(
  sql`
    SELECT id, title, fetched_at AS "fetchedAt", ...
    FROM (
      SELECT ..., ROW_NUMBER() OVER (
        PARTITION BY COALESCE(a.content_hash, '#' || a.id)
        ORDER BY ...
      ) AS rn
      FROM articles a
      ...
    ) sub
    WHERE rn = 1
    ORDER BY ... DESC
    LIMIT 100
  `,
) as unknown as FeedRow[];
```

**问题**:
- 完全绕过 Drizzle 查询构建器，丢失类型安全
- `as unknown as FeedRow[]` 双重断言，无编译时检查
- 手动定义 `FeedRow` 接口与 DB 列脱节
- TIMESTAMP 列返回 Unix 秒数整数，需要手动 `* 1000` 转换为 Date

**建议**: 使用 Drizzle ORM 查询构建器或至少将 SQL 逻辑封装到独立的数据访问层 (`src/data/feed.ts`)，提供类型安全的接口。

#### 问题 2.1.2: 缺少关键查询索引

**位置**: `db/schema.ts:55-74`

当前 articles 表只有:
- `url` UNIQUE 约束（隐式索引）
- `site_id` → sites.id 外键

**缺失的索引**:
- `(viewed_at, status, published_at)` — feed 查询的 WHERE 条件
- `(status)` — analyze 批次扫描 `WHERE status = 'raw'`
- `(content_hash)` — 去重查询 PARTITION BY 和 view 级联

**影响**: 随数据量增长，SQLite 全表扫描 `articles`，feed 查询延迟线性上升。

**建议**: 添加以下联合索引:
```sql
CREATE INDEX idx_articles_feed ON articles(viewed_at, status, published_at DESC);
CREATE INDEX idx_articles_status ON articles(status);
CREATE INDEX idx_articles_content_hash ON articles(content_hash);
```

#### 问题 2.1.3: 硬编码 100 条数据一次性加载

**位置**: `app/feed/page.tsx:63`

当前 LIMIT 100，无分页/无限滚动。SQLite 本身轻量，100 条查询几乎无延迟，但:
- 随着站点和文章增多，100 条的去重子查询扫描范围扩大
- 前端一次性渲染 100 个卡片 DOM 节点，尤其在移动端可能造成渲染卡顿
- 如果日后面向更多站点（如 100+），15 天窗口可能有 500+ 篇文章去重后仍然很多

**建议**: 底部增加"加载更多"，每次加载 30 条。首次 SSR 渲染前 30 条，后续通过客户端 fetch 按 OFFSET 追加。

#### 问题 2.1.4: 15 天硬编码时间窗，SQL 效率待优化

**位置**: `app/feed/page.tsx:54-58`

```sql
AND (
  a.published_at >= ${fifteenDaysAgoSec}
  OR (a.published_at IS NULL AND a.fetched_at >= ${fifteenDaysAgoSec})
)
```

- `published_at IS NULL OR ... >= ${cutoff}` 不容易利用索引
- 15 天是写死的，用户无法调整

**建议**: 
1. 改为中心化的时间过滤：统一用 `MAX(published_at, fetched_at)` 或 `COALESCE(published_at, fetched_at) >= cutoff`
2. 提供前端时间范围选择器

#### 问题 2.1.5: 服务端渲染无缓存

**位置**: `app/feed/page.tsx:6`

`export const dynamic = "force-dynamic"` — 每次请求都重新查库。

**建议**: 
- 在 Next.js 15 中使用 `unstable_cache` 或自定义缓存层缓存 feed 查询结果（30s-60s TTL）
- 使用 `revalidateTag` 或 `revalidatePath` 在采集完成后主动失效

### 2.2 前端渲染性能

#### 问题 2.2.1: 无 Suspense 边界

**位置**: `app/feed/page.tsx:100`

整个页面等待 DB 查询完成后才渲染。`app/layout.tsx` 也无 loading.tsx。

**建议**: 添加 `app/feed/loading.tsx` 骨架屏，或使用 `<Suspense>` 包裹查询组件。

#### 问题 2.2.2: 客户端 JavaScript 体积

**位置**: `app/components/FeedCard.tsx`

FeedCard 是 `"use client"` 组件。100 个卡片 = 100 个独立的事件处理器闭包。虽然 React 19 做了优化，但仍然有开销。

**建议**: 
- 考虑将"已阅读"按钮的交互逻辑提取到父组件，通过事件委托减少监听器数量
- 使用 `memo` 避免未变化卡片的无谓重渲染

---

## 3. 用户体验缺陷

### 3.1 无时间分组，信息定位困难

**当前状态**: 所有文章按 `category`（站点分类）分组展示，"国家级科技部门"、"省级科技部门"、"市级科技部门"等。

**问题**: 用户最自然的浏览方式是"今天有什么新资讯？"而不是"国家级科技部门今天发了什么？"

**建议**: **优先按日期分组，再按 category 分组**:
```
📅 今天（7月9日） · 12篇
  ├─ 国家级科技部门（5）
  ├─ 省级科技部门（4）
  └─ 市级科技部门（3）

📅 昨天（7月8日） · 8篇
  ├─ 国家级科技部门（3）
  └─ ...

📅 本周 · 20篇
  └─ ...
```

### 3.2 缺少筛选和搜索

**当前状态**: 无任何筛选/搜索功能。用户只能被动浏览。

**缺失的功能**:
- 关键词搜索（标题/摘要）
- 按站点筛选
- 按时间范围筛选（今天/昨天/本周/自定义）
- 按 AI 质量评分排序 (quality_score)
- 按新闻属性过滤 (is_news)

**建议**: 在页面顶部添加一个简单的筛选栏，包含:
- 搜索框（客户端过滤标题/摘要）
- 站点下拉多选
- 时间范围快捷按钮（今天/昨天/本周/全部）

### 3.3 无"全部已读"操作

**当前状态**: 用户必须逐个点击每个文章的"已阅读"按钮。如果有 30 篇新文章，需要点 30 次。

**建议**: 在每个分组标题旁、页面顶部各添加"全部已读"按钮，批量标记当前可见文章（或整个分组）为已读。

### 3.4 "已阅读"按钮交互粗糙

**位置**: `app/components/FeedCard.tsx:20-31`

- 点击后卡片即时消失（`setDismissed(true)` → `return null`），无过渡动画
- API 调用是 fire-and-forget（无加载状态、无错误反馈）
- 如果 API 失败（网络问题），卡片已消失但服务器未标记 — 刷新后文章又回来

**建议**:
- 添加淡出动画 (opacity + height 过渡)
- 显示 Toast 通知失败情况
- 在没网络时缓存待操作列表，重连后批量提交

### 3.5 无空状态引导

**位置**: `app/feed/page.tsx:108-111`

```tsx
{!ordered.length ? (
  <div>暂无新资讯 ✓</div>
) : (...)}
```

空状态仅显示一行文字。没有引导用户下一步做什么（查看历史？检查采集状态？）

### 3.6 无文章收藏/标记功能

用户阅读过程中可能想保存重要文章，目前只能通过"不点已读"来保留。一旦标记已读，文章就从 feed 消失，无法回顾。

### 3.7 无"返回顶部"按钮

当有多天/多分类内容时，滚动到页面下方后无快速返回的途径。

---

## 4. 信息架构问题

### 4.1 文章列表过于扁平

**位置**: `app/feed/page.tsx:114-129`

当前：按 category 分一级分组，内部直接列出所有文章卡片。

**改进**: 二级分组结构（日期 → 类别），每个分组可折叠。

### 4.2 AI 摘要展示不充分

**位置**: `app/components/FeedCard.tsx:50-53`

摘要使用 `line-clamp-2` 截断，只显示 2 行。对于正文较长的重要资讯，2 行不足以传达关键信息。

**建议**: 在卡片内增加可展开/收起的功能。

### 4.3 卡片信息密度偏低

**位置**: `app/components/FeedCard.tsx:34-66`

当前卡片信息:
1. AI 标题（加粗，单行）
2. 原标题（灰色小字，仅当与AI标题不同时显示）
3. AI 摘要（灰色，2行）
4. 来源站名 + 日期

**缺失的有用信息**:
- 关键标签 (tags from ai_reviews) — 已存储在数据库但未展示
- 质量/新闻评分 — 可帮助用户判断阅读优先级
- 相关度标记

### 4.4 查看过的文章不可回溯

**当前状态**: `viewed_at IS NOT NULL` 后文章从 feed 永久消失。用户无法回顾之前看过的内容。

**建议**: 
- Feed 页默认展示未读 + 今天已读（降低信息密度）
- 或者提供"已读历史"tab 切换

---

## 5. 代码质量问题

### 5.1 数据访问层缺失

**位置**: `app/feed/page.tsx:27-64`

SQL 查询直接写在 JSX 组件中。理想的架构是:

```
app/feed/page.tsx       →  页面布局
src/data/feed.ts         →  feedQuery({ days: 15, limit: 100 }) 
src/data/articles.ts     →  markViewed(id), 级联同 hash
```

### 5.2 类型断言不安全的强制转换

```typescript
as unknown as FeedRow[]
```

如果 DB 列名或 SQL 查询变更，TypeScript 不会报错——运行时才会暴露。

### 5.3 无错误处理

**位置**: `app/feed/page.tsx:27`

SQL 查询未包裹在 try/catch 中。如果 SQLite 文件损坏或锁冲突，页面直接 500。

### 5.4 时间戳转换逻辑分散

**位置**: 多处

- feed page: `new Date(r.fetchedAt * 1000)` 手动转换 Unix 秒
- articles page: 直接使用 Drizzle ORM 的 timestamp mode
- 两种方式混用，容易出错

根本原因：feed page 使用原始 SQL 绕过 Drizzle 的 timestamp mode，返回的是原始整数。

### 5.5 无测试覆盖

整个 feed 管道（查询去重 → 分组展示 → 标记已读）没有任何单元测试或集成测试。

---

## 6. 数据模型考量

### 6.1 `viewed_at` 的两种语义冲突

**当前**: `viewed_at NOT NULL` = "已读" = "从 feed 中隐藏"。但这混合了两个不同概念:
- **阅读状态**: 用户是否看过这篇文章
- **展示状态**: 文章是否出现在 feed 中

**建议**: 
- 保留 `viewed_at` 作为纯阅读记录
- 新增 `archived_at` 或 `hidden_at` 用于控制 feed 显示
- 或者 feed 查询改为 `COALESCE(viewed_at, 0) > 某个时间` 来实现"显示今天已读"

### 6.2 `content_hash` 的唯一性

**位置**: `src/pipeline/dedup.ts:4-7`

```typescript
export function contentHash(body: string): string {
  const norm = body.replace(/\s+/g, " ").trim().toLowerCase();
  return createHash("sha1").update(norm).digest("hex").slice(0, 16);
}
```

16 位十六进制 = 64 bit 空间。对于万级别文章，碰撞概率极低，但目前去重依赖 `PARTITION BY content_hash + ROW_NUMBER`，总有极小的误去重风险。

此外，没有对 `null` hash 文章的降级策略（当前用 `'#' || a.id` 兜底，每个 null-hash 文章都视为唯一）。

### 6.3 缺少 `articles` 表上的 `updated_at` 字段

文章可能会被重新抓取并更新（runner 中 `UPDATE articles SET ...`），但没有 `updated_at`。这使得无法判断"哪些文章最近更新过内容"。

---

## 7. 移动端适配

### 7.1 FeedCard 在小屏上的布局

**位置**: `app/components/FeedCard.tsx:37`

```tsx
className="group flex items-center rounded-xl ..."
```

`flex items-center` 在宽度 < 360px 时，"已阅读"按钮与标题可能挤压。

### 7.2 缺少滑动操作

在移动端，常见的 UX 模式是左滑标记已读/删除。当前只支持精确点击小按钮。

### 7.3 页面内边距

`px-6` (24px) 在移动端 (320px 宽) 下内容区域只有 ~270px。可考虑小屏使用 `px-4`。

---

## 8. 优化建议优先级矩阵

按**影响程度 × 实现成本**排序:

| 优先级 | 优化项 | 影响 | 成本 | 类型 |
|--------|--------|------|------|------|
| 🔴 P0 | 添加文章表查询索引 | 高 | 低 | 性能 |
| 🔴 P0 | 日期分组展示（今天/昨天/本周） | 高 | 中 | UX |
| 🔴 P0 | 添加搜索/筛选栏 | 高 | 中 | UX |
| 🟠 P1 | "全部已读"按钮 | 中 | 低 | UX |
| 🟠 P1 | 分页/"加载更多" | 中 | 中 | 性能+UX |
| 🟠 P1 | 已阅读按钮动画+错误处理 | 中 | 低 | UX |
| 🟠 P1 | 数据访问层封装 | 中 | 中 | 代码 |
| 🟡 P2 | 卡片展示 tags/评分 | 中 | 低 | 信息 |
| 🟡 P2 | 骨架屏/Suspense | 低 | 低 | 体验 |
| 🟡 P2 | 感兴趣/收藏标记 | 低 | 中 | 功能 |
| 🟡 P2 | 移动端滑动操作 | 低 | 中 | 移动端 |
| 🟢 P3 | 查询缓存 | 中 | 高 | 性能 |
| 🟢 P3 | 已读历史页 | 低 | 中 | 功能 |
| 🟢 P3 | 自动化测试 | 低 | 高 | 质量 |

---

## 9. 详细实施方案

### 9.1 P0-1: 添加数据库索引

```sql
-- 在 db/schema.ts 或迁移脚本中添加
CREATE INDEX IF NOT EXISTS idx_articles_feed_lookup 
  ON articles(viewed_at, status, COALESCE(published_at, fetched_at) DESC);

CREATE INDEX IF NOT EXISTS idx_articles_status 
  ON articles(status);

CREATE INDEX IF NOT EXISTS idx_articles_content_hash 
  ON articles(content_hash);
```

**验证方法**: 使用 `EXPLAIN QUERY PLAN` 确认 feed 查询走了索引而非全表扫描。

### 9.2 P0-2: 日期分组改造

当前分组逻辑在 `app/feed/page.tsx:80-97`，改为:

```typescript
// 先按日分组，同日内按 category 分组
type DayGroup = { label: string; categories: CategoryGroup[] };
type CategoryGroup = { category: string; articles: ArticleRow[] };

const dayGroups: DayGroup[] = [];
const today = new Date().toDateString();
const yesterday = new Date(Date.now() - 86400000).toDateString();

for (const row of rows) {
  const dateStr = row.publishedAt 
    ? new Date(row.publishedAt).toDateString() 
    : new Date(row.fetchedAt).toDateString();
  
  let label: string;
  if (dateStr === today) label = "今天";
  else if (dateStr === yesterday) label = "昨天";
  else label = new Date(dateStr).toLocaleDateString("zh-CN", { 
    month: "short", day: "numeric", weekday: "short" 
  });
  
  // ... 构建嵌套分组结构
}
```

### 9.3 P0-3: 筛选/搜索栏

在 feed 页面顶部添加客户端筛选组件 `FeedFilters`:

```
┌─────────────────────────────────────────────────┐
│ 🔍 搜索标题/摘要...  │ 站点▼ │ 今天 昨天 本周  │
└─────────────────────────────────────────────────┘
```

- 搜索框: 客户端 JavaScript 对已加载的文章做 `title.includes()` / `summary.includes()` 过滤
- 站点筛选: 从已加载文章中提取站点列表
- 时间范围: 保持服务端 15 天窗口，前端再细分
- 如果有大量文章，"加载更多"后筛选变为服务端

### 9.4 P1-1: "全部已读"

新增 API: `POST /api/articles/view-batch` — 接收 `{ ids: number[] }` 或 `{ category: string }`

在页面顶部和每个分组标题旁各放一个按钮。

### 9.5 P1-2: "加载更多"

```typescript
// src/data/feed.ts
export async function getFeedArticles(opts: {
  days?: number;
  limit?: number;
  offset?: number;
  siteId?: number;
  category?: string;
}): Promise<{ articles: ArticleRow[]; total: number }> { ... }
```

前端使用 `<Suspense>` + `useOptimistic` + 客户端 fetch 追加数据。

### 9.6 P1-3: 数据访问层

创建 `src/data/feed.ts`:

```typescript
import { db, schema } from "@/db/client";
import { sql } from "drizzle-orm";

export interface FeedArticle { ... }
export interface FeedQuery { days: number; limit: number; offset: number }

export async function queryFeedArticles(q: FeedQuery): Promise<FeedArticle[]> { ... }
export async function countUnread(): Promise<number> { ... }
```

### 9.7 P2-1: 卡片展示增强

在 `FeedCard` 中展示 `tags` 和 `qualityScore`:

```tsx
{article.tags?.map(tag => (
  <span key={tag} className="text-xs bg-slate-100 rounded px-1.5 py-0.5">{tag}</span>
))}
<div className="text-xs text-amber-500">
  {article.qualityScore != null ? `★ ${article.qualityScore.toFixed(1)}` : null}
</div>
```

---

## 附录 A: 现有 Feed SQL 查询解析

```sql
-- 逐层说明
SELECT id, title, fetched_at, published_at, site_id, site_name, category, summary, headline
FROM (
  SELECT
    a.id, a.title, a.fetched_at, a.published_at, a.site_id,
    s.name AS site_name, s.category,
    r.summary, r.headline,
    ROW_NUMBER() OVER (
      PARTITION BY COALESCE(a.content_hash, '#' || a.id)
      -- ↑ 同 content_hash 的文章归为一组
      ORDER BY
        CASE WHEN r.id IS NOT NULL THEN 0 ELSE 1 END,
        -- ↑ 有 AI review 的优先（r.id NOT NULL 排前面）
        COALESCE(a.published_at, a.fetched_at) DESC
        -- ↑ 同样的 AI 状态下按时间降序
    ) AS rn
  FROM articles a
  INNER JOIN sites s ON a.site_id = s.id
  LEFT JOIN ai_reviews r ON a.id = r.article_id
  WHERE a.viewed_at IS NULL          -- 未查看
    AND a.status = 'published'        -- 已发布
    AND (
      a.published_at >= #{cutoff}
      OR (a.published_at IS NULL AND a.fetched_at >= #{cutoff})
    )                                 -- 15天内
) sub
WHERE rn = 1                          -- 只取每组的第1条
ORDER BY COALESCE(published_at, fetched_at) DESC
LIMIT 100
```

**关键洞察**: 去重策略优先保留"有 AI 摘要的"，如有多篇同 hash 都有 review，保留最新的。

## 附录 B: 关键目录结构

```
app/
├── feed/
│   └── page.tsx              ← 资讯流页面（本报告核心）
├── components/
│   ├── FeedCard.tsx          ← 单个资讯卡片
│   ├── MarkViewed.tsx        ← 从feed进入详情自动已读
│   ├── NavLinks.tsx          ← 导航栏（无未读计数badge）
│   └── Badges.tsx            ← 状态标签
├── articles/
│   ├── page.tsx              ← 文章列表页（有状态筛选）
│   └── [id]/page.tsx         ← 文章详情+AI审核面板
├── api/articles/[id]/view/
│   └── route.ts              ← 标记已读API
src/
├── pipeline/
│   ├── runner.ts             ← 采集+去重+写入
│   └── dedup.ts              ← SHA1 content_hash
├── ai/
│   ├── intelligent-crawl.ts  ← LLM自适应爬虫
│   └── analyze.ts            ← AI审核批处理
db/
└── schema.ts                 ← 数据库表定义
```

---

> **总结**: 当前feed页面的核心数据管道（采集→去重→AI审核→展示）是健全的，但前端展示层严重缺乏时间感知、筛选搜索、批量操作等关键功能。最高的ROI改动是：添加数据库索引（5分钟）+ 改造为日期优先分组（2小时）+ 添加筛选搜索栏（3小时），这三项改动即可显著提升日常使用体验。
