# 资讯流积压优化方案

> **生成日期**: 2026-07-28
> **问题**: 用户并非每天阅读，但三天不看资讯流就会累积到「好几十页」新闻，无法消费
> **分析依据**: 基于线上 `data/collector.db` 实测数据（非估算），结合源码链路（`src/data/feed.ts` / `app/components/FeedList.tsx` / `src/ai/sandbox.ts` / `src/scheduler/cron.ts`）

---

## 目录

1. [现状量化](#1-现状量化实测)
2. [根因分析](#2-根因分析)
3. [优化方案总览](#3-优化方案总览)
4. [Phase 1：清积压](#phase-1清积压立即见效)
5. [Phase 2：堵源头](#phase-2堵源头让积压不再增长)
6. [Phase 3：提质量](#phase-3提质量中长期可选)
7. [落地实施](#7-落地实施)

---

## 1. 现状量化（实测）

通过容器内直接查询 `collector.db`，关键数据如下：

| 指标 | 实测数值 | 说明 |
|------|----------|------|
| 启用站点 | **100 个** | seed 文件仅 10 个，已增长到 100 |
| 采集频率 | `0 5 * * *`（每天 1 次） | `settings.cron_interval` |
| 每次采集量 | 平均 **460 篇** / 峰值 657 | 近 7 天 crawl session 均值 |
| 近 7 天 published | 1769 篇 ≈ **~250 篇/天** | 即每天净产出 |
| **近 15 天未读积压** | **1897 篇 ≈ 64 页** | **← 「好几十页」的真相** |
| AI 评分分布 | 0.8-1.0 占 **72%**，0.6-0.8 占 25% | 评分集中在高位 |
| 用户实际已读 | TastSong **73 篇** | 与每天 250 篇产出严重失衡 |

**核心矛盾**：系统每天产出约 250 篇「已通过 AI」的文章，而用户每周实际只读约 25 篇。在 15 天滚动窗口下，积压必然膨胀到几十页。

### 1.1 嘈杂源 TOP（近 7 天入库量）

| 站点 | 近 7 天 | 渲染 |
|------|---------|------|
| 网易科技 | 170 | static |
| 科学网 | 148 | static |
| 新浪科技 | 138 | static |
| 电子工程专辑 | 125 | static |
| 盖世汽车 | 125 | static |
| 51CTO | 123 | dynamic |
| 中国科技网 | 117 | static |
| 36 氪 | 112 | dynamic |

> 媒体类站点（网易/新浪/科学网）单周 130-170 篇，是积压的主要贡献者。

---

## 2. 根因分析

### 根因一：源头无限流

100 个站点全部全量入库，每个站点的抓取量由其首页更新频率决定，系统侧没有任何「单站每日上限」。嘈杂源（网易 170/周、科学网 148/周）直接拉高整体水位。

### 根因二：「全部已读」是假清空

`app/components/FeedList.tsx:279` 的 `markAllRead` 只标记 **当前页 30 条** 为已读：

```ts
const markAllRead = useCallback(async () => {
  const ids = filtered.map((a) => a.id);  // ← 仅当前页的 filtered 集合
  ...
}, [filtered, ...]);
```

64 页积压需要翻 64 次才能清空，**完全没有「一键追平」的逃生口**。

### 根因三：评分失去判别力

`src/ai/sandbox.ts:147` 的 `decideStatus` 当前判定逻辑：

```ts
// 综合评分 = qualityScore * 0.7 + newsScore * 0.3
// combined < AI_PUBLISH_THRESHOLD(0.5) → rejected
```

实测问题：
- **72% 的文章评分在 0.8-1.0** —— AI 几乎把所有人都评为「优秀」，`qualityScore` 失去了区分度。
- 实测把阈值从 0.5 提到 0.7，只能减少 19%（3786 → 3063），**治标不治本**。
- `newsScore` / `isNews` 字段虽然有（schema 里已定义），但 `decideStatus` **完全没用到**。真正该收紧的是「新闻属性」而非「质量分」。

---

## 3. 优化方案总览

```
Phase 1（清积压，1-2 天）:  A 一键追平 + B 未读自动过期 + C 今日精选
Phase 2（堵源头，本周）   :  D 每站每日配额 + E 收紧发布闸门
Phase 3（提质量，后续）   :  G 跨站去重 → F 校准 AI → H 每日摘要
```

| 优先级 | 改动 | 解决的问题 | 预期效果 |
|--------|------|-----------|---------|
| 🟢 Phase 1 | A. 真正的一键追平 | 无逃生口 | 一秒回到 0 页 |
| 🟢 Phase 1 | B. 未读自动过期 | 窗口无限膨胀 | 15 天 → 7 天，积压砍半 |
| 🟢 Phase 1 | C. 今日 Top 10 精选 | 信息过载 | 不翻页也能看到当天最值得看的 |
| 🟡 Phase 2 | D. 每站每日配额 | 嘈杂源拖高水位 | ~150/天，砍 40% |
| 🟡 Phase 2 | E. 收紧发布闸门 | 噪音混入资讯流 | 大幅过滤非新闻内容 |
| 🔵 Phase 3 | F. 重新校准 AI 打分 | 评分无区分度 | 评分恢复判别力 |
| 🔵 Phase 3 | G. 跨站聚类去重 | 同事件重复报道 | 多源合并为 1 条要闻 |
| 🔵 Phase 3 | H. 每日 AI 摘要 | 信息密度低 | 每天压成 5 条 digest |

---

## Phase 1：清积压（立即见效）

### A. 真正的一键追平

**改动点**：
- 新增 `POST /api/feed/clear`，服务端批量将 N 天前的未读文章标记为已读（直接操作 `user_article_views` 表，不限页数）。
- 「全部已读」按钮改为下拉菜单：
  - `清空全部未读`
  - `只保留今天`
  - `保留近 2 天`

**实现要点**：
```sql
-- 批量插入未读记录（按时间过滤）
INSERT INTO user_article_views (user_id, article_id, viewed_at)
SELECT ?, a.id, unixepoch()
FROM articles a
WHERE a.status = 'published'
  AND NOT EXISTS (SELECT 1 FROM user_article_views uv WHERE uv.user_id = ? AND uv.article_id = a.id)
  AND COALESCE(a.published_at, a.fetched_at) < ?  -- 早于保留边界
```

**影响文件**：新增 `app/api/feed/clear/route.ts`；修改 `app/components/FeedList.tsx` 的按钮区。

### B. 未读自动过期

**改动点**：在 cron 采集完成后，增加一步「过期清理」——`published_at` 超过 7 天仍未读的，自动标记为已读。

**实现要点**：
- 在 `src/scheduler/cron.ts` 的 `runAll()` 末尾调用一个 `expireUnread(maxDays)` 函数。
- 过期天数可配置（`settings.feed_retention_days`，默认 7）。
- 与 A 共享同一段批量 SQL。

**效果**：将 `feed.ts` 里的「近 15 天」窗口 (`feedWhere` 中的 `1296000` 秒) 改为 7 天后，积压直接砍半；即便不改窗口，过期机制也能保证未读不会无限累积。

### C. 今日 Top 10 精选

**改动点**：
- feed 顶部新增「今日精选」区，跨站点按 `quality_score` 排序、去重后取 Top 10。
- 其余文章折叠在下方（保留现有「今天/昨天/本周/更早」分组）。

**实现要点**：
- 在 `src/data/feed.ts` 新增 `queryTodayTop(userId, limit)`。
- 复用现有的 `ROW_NUMBER() OVER (PARTITION BY content_hash ...)` 去重逻辑。

---

## Phase 2：堵源头（让积压不再增长）

### D. 每站每日配额

**改动点**：在 `src/ai/analyze.ts` 批次末尾，按 `(site_id, published_日期)` 分组，每组只保留评分 Top-N（默认 8）进入 `published`，其余落 `rejected`。

**实现要点**：
```sql
-- 伪逻辑：标记超出配额的文章为 rejected
WITH ranked AS (
  SELECT a.id, ROW_NUMBER() OVER (
    PARTITION BY a.site_id, date(a.published_at, 'unixepoch')
    ORDER BY r.quality_score DESC
  ) rn
  FROM articles a JOIN ai_reviews r ON r.article_id = a.id
  WHERE a.status = 'published'
    AND a.published_at >= strftime('%s', 'now', '-1 day')
)
UPDATE articles SET status = 'rejected'
WHERE id IN (SELECT id FROM ranked WHERE rn > ?);  -- ? = 配额 N
```

**效果**：100 站 × 8 = 理论上限 800/天，实际约 150/天，**整体入库量砍掉 40%**。

**注意**：政府类站点（科技部/青岛科技局等）内容少但重要，可能需要单独配置更高的配额（建议在 `sites` 表加一列 `daily_quota`，默认 8，政府站设 20+）。

### E. 收紧发布闸门（启用 newsScore）

**改动点**：修改 `src/ai/sandbox.ts:147` 的 `decideStatus`：

```ts
export function decideStatus(r: Review): "published" | "rejected" {
  if (!r.usable) return "rejected";
  // 新增：只放行真正的新闻/动态，挡掉教程/文档/产品介绍页
  if (!r.isNews || r.newsScore < 0.6) return "rejected";
  const combined = r.qualityScore * 0.7 + r.newsScore * 0.3;
  if (combined < threshold("AI_PUBLISH_THRESHOLD", 0.5)) return "rejected";
  return "published";
}
```

**效果**：当前 `newsScore` 字段在 schema 和 prompt 里都已产出，但 `decideStatus` 完全没用。启用后可大幅过滤非新闻类噪音。阈值（0.6）和 `AI_PUBLISH_THRESHOLD` 都走 env 配置，便于调参。

---

## Phase 3：提质量（中长期，可选）

### F. 重新校准 AI 打分

**问题**：当前 72% 文章评分在 0.8-1.0，AI 打分太「好人」，失去区分度。

**改动点**：修改 `src/ai/sandbox.ts` 的 system prompt：
- 要求评分分布使用全区间（0-1），不要默认给高分。
- 给出锚点示例（什么样的文章该 0.3、0.6、0.9）。
- 配合 E 一起验证效果。

### G. 跨站聚类去重

**问题**：5 个媒体常报道同一事件，但现有去重只按 `content_hash`（正文哈希，`src/pipeline/dedup.ts`），不同媒体正文不同，抓不到。

**改动点**：
- 对同一天 published 的文章，按标题相似度（如 SimHash / Jaccard）聚类。
- 聚类后合并为「1 条要闻 + N 篇来源」展示，feed 里只占一个位置。

### H. 每日 AI 摘要 digest

**改动点**：每天用一次 AI 把当天 Top 文章压成 5 条要闻摘要，作为 digest 展示在 feed 顶部。降低单篇阅读压力，提高信息密度。

---

## 7. 落地实施

### 推荐实施顺序

```
Phase 1（1-2 天，立即见效）:  A 一键追平 + B 自动过期 + C 今日精选
Phase 2（本周）            :  D 每站配额 + E 收紧 newsScore
Phase 3（后续）            :  G 跨站去重 → F 校准 → H 每日摘要
```

### 待确认参数

| 参数 | 建议 | 说明 |
|------|------|------|
| 未读过期天数 | **7 天** | `settings.feed_retention_days` |
| feed 滚动窗口 | 15 → **7 天** | `feed.ts` 中 `1296000` 秒常量 |
| 每站每日配额 N | **8 篇** | 政府类站点可单独设 20+ |
| `newsScore` 阈值 | **0.6** | 新增到 `decideStatus` |
| 今日精选数量 | **10 篇** | feed 顶部 Top 10 |

### 涉及的关键文件

| 文件 | Phase | 改动 |
|------|-------|------|
| `app/api/feed/clear/route.ts` | A | 新增：批量清未读 |
| `app/components/FeedList.tsx` | A、C | 改按钮为下拉；加今日精选区 |
| `src/scheduler/cron.ts` | B | `runAll()` 末尾加过期清理 |
| `src/data/feed.ts` | B、C | 窗口常量；新增 `queryTodayTop` |
| `db/schema.ts` | D | `sites` 表加 `daily_quota` 列（可选） |
| `src/ai/analyze.ts` | D | 批次末尾按配额裁剪 |
| `src/ai/sandbox.ts` | E、F | `decideStatus` 启用 newsScore；校准 prompt |

### 验证方式

所有改动按 CLAUDE.md 规范，**在 Docker 容器内验证**：

```bash
docker compose exec app pnpm typecheck        # 类型检查
docker compose exec app pnpm scheduler        # 验证过期清理（独立调度进程）
docker compose restart                        # 重启生效
docker compose logs -f                        # 观察日志
```

效果验证（容器内查库）：

```bash
# 积压规模应显著下降
docker compose exec app node -e '
const Database = require("better-sqlite3");
const db = new Database("data/collector.db", { readonly: true });
const now = Math.floor(Date.now()/1000);
const feedCnt = db.prepare("SELECT COUNT(DISTINCT COALESCE(content_hash, \"#\"||id)) c FROM articles WHERE status=? AND (published_at >= ? OR (published_at IS NULL AND fetched_at >= ?))").get("published", now-7*86400, now-7*86400).c;
console.log("近 7 天未读 published(去重):", feedCnt, "≈", Math.ceil(feedCnt/30), "页");
'
```

---

## 附录：数据采集脚本

本文档所有数据均来自以下容器内查询（只读，不影响运行）：

```bash
docker compose exec app node -e '
const Database = require("better-sqlite3");
const db = new Database("data/collector.db", { readonly: true });
console.log("站点:", db.prepare("SELECT COUNT(*) c FROM sites WHERE enabled=1").get().c);
console.log("published:", db.prepare("SELECT COUNT(*) c FROM articles WHERE status=?").get("published").c);
console.log("近15天未读积压:", db.prepare("SELECT COUNT(DISTINCT COALESCE(content_hash, \"#\"||id)) c FROM articles WHERE status=? AND (published_at >= ? OR (published_at IS NULL AND fetched_at >= ?))").get("published", Math.floor(Date.now()/1000)-15*86400, Math.floor(Date.now()/1000)-15*86400).c);
'
```
