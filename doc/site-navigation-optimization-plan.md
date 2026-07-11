---
name: site-navigation-optimization-plan
description: 网站导航和页面结构优化方案：将资讯流设为首页，仪表盘独立为子页面
metadata:
  type: project
---

# 网站页面结构优化分析

**日期**: 2026-07-11
**问题**: 当前 `/` 是仪表盘（标题写"仪表盘"但导航写"首页"），`/feed` 才是资讯流——用户日常使用的核心页面。导航结构不符合实际使用流程。

## 一、现状诊断

### 当前页面与导航

| 路由 | 页面标题 | 导航标签 | 实际用途 |
|------|---------|---------|---------|
| `/` | 仪表盘 | 首页 | 系统总览、采集触发、调度、站点概况 |
| `/feed` | 资讯流 | 资讯流 | **用户核心页面**：浏览未读情报、标记已读、收藏 |
| `/history` | 已读历史 | 历史 | 回顾已读文章 |
| `/articles` | 文章流 | 文章 | 全量文章管理（含原始/驳回/审核中） |
| `/sites` | 站点配置 | 站点 | CRUD 爬取站点 |
| `/runs` | 运行日志 | 日志 | 采集运行记录 |

### 核心矛盾

1. **首页不是"首页"** — `/` 标题是"仪表盘"，导航却叫"首页"，概念分裂
2. **使用频率倒挂** — 用户 90% 时间在 `/feed` 浏览情报，却要每次点导航第二项
3. **登录后落地页错误** — 登录后跳转 `/`（仪表盘），用户还要再点一次才能看到想看的资讯
4. **/articles 定位模糊** — 展示所有状态的原始文章列表，普通用户无此需求，更偏管理调试

### 正确的使用流程

```
登录 → 浏览资讯流（标记已读/收藏）→ 偶尔查看仪表盘（系统状态）
                                  → 偶尔管理站点
                                  → 偶尔回顾历史
                                  → 偶尔排查日志
```

---

## 二、优化方案（分P0-P3四个优先级）

### P0 — 路由重组（核心改动）

| 改动 | 当前 | 目标 |
|------|------|------|
| 首页 | `/` → 仪表盘 | `/` → **资讯流** |
| 仪表盘 | 无独立路由 | `/dashboard` → **仪表盘** |
| 资讯流 | `/feed` | 删除，内容合并到 `/` |

**涉及文件**：
- `app/page.tsx` — 替换为 feed/page.tsx 的内容
- `app/feed/` — 整个目录可删除或重定向
- 新建 `app/dashboard/page.tsx` — 迁移当前 page.tsx 的内容
- `app/layout.tsx` — Logo 链接确认（已指向 `/`，无需改）
- `app/components/NavLinks.tsx` — 导航重排
- `app/login/page.tsx` — 登录后跳转已是 `/`，无需改

### P1 — 导航重排

推荐新导航顺序（按使用频率）：

```
资讯流 → 历史 → 仪表盘 → 站点 → 日志
```

移除 `/articles` 的主导航入口（保留路由，从仪表盘"站点概况"链接进入）。
删除 `/feed` 入口。

**NavLinks.tsx 改动**：
```tsx
<NavLink href="/">资讯流</NavLink>
<NavLink href="/history">历史</NavLink>
<NavLink href="/dashboard">仪表盘</NavLink>
<NavLink href="/sites">站点</NavLink>
<NavLink href="/runs">日志</NavLink>
```

### P2 — 功能增强

1. **资讯流顶部添加紧凑统计条**
   - 今日新增 N 篇 · 待读 N 篇 · 收藏 N 篇
   - 点击可跳转仪表盘查看详情
   - 无需额外查询（feed 查询已包含 total）

2. **仪表盘增强**
   - 添加"快捷操作"卡片：一键采集、查看今日情报
   - 添加"最近收藏"预览
   - 添加"站点健康"状态（最近一次采集是否成功）

3. **文章详情页面包屑修正**
   - `app/articles/[id]/page.tsx` 中 `from=feed` 改为 `from=home`（或直接用 `/` 表示首页）
   - 返回链接文字修正

4. **兼容性重定向**
   - 添加 `app/feed/page.tsx` 重定向到 `/`（防止旧书签 404）
   ```tsx
   import { redirect } from "next/navigation";
   export default function FeedRedirect() { redirect("/"); }
   ```

### P3 — 代码质量

1. **DRY 重复的 tags 解析逻辑**
   - `tryParseTags` 在 `app/feed/page.tsx`、`app/history/page.tsx`、`app/feed/FeedList.tsx`、`app/history/HistoryList.tsx` 中重复了 4 次
   - 提取为 `@/src/lib/parse-tags.ts`

2. **统一分页组件**
   - FeedList 和 HistoryList 中的分页 UI 几乎相同
   - 提取为 `<Pagination>` 组件

3. **/articles 页面角色明确**
   - 保留路由但降级为"管理员工具"
   - 仅在仪表盘和站点详情页中链接到它
   - 不出现主导航中

---

## 三、影响范围矩阵

| 文件 | 改动类型 | 风险 |
|------|---------|------|
| `app/page.tsx` | 重写（变为资讯流） | 中 |
| `app/feed/page.tsx` | 重定向到 `/` | 低 |
| `app/feed/FeedList.tsx` | 移动到 `app/components/` | 低 |
| `app/dashboard/page.tsx` | 新建（当前 page.tsx） | 低 |
| `app/components/NavLinks.tsx` | 修改链接数组 | 低 |
| `app/articles/[id]/page.tsx` | 修改返回链接 | 低 |
| `app/layout.tsx` | 无需改 | 无 |
| `app/login/page.tsx` | 无需改 | 无 |

---

## 四、实施步骤（预估工作量：2-3小时）

1. **创建 `/dashboard` 路由** (15min)
   - `mkdir app/dashboard`
   - 迁移当前 `app/page.tsx` → `app/dashboard/page.tsx`
   - 调整导入路径

2. **将资讯流提升为首页** (15min)
   - 迁移 `app/feed/page.tsx` 内容 → `app/page.tsx`
   - 迁移 `app/feed/FeedList.tsx` → `app/components/FeedList.tsx`
   - 更新所有导入

3. **添加重定向** (5min)
   - `app/feed/page.tsx` → redirect to `/`

4. **更新导航** (10min)
   - `NavLinks.tsx`：新顺序、新链接

5. **更新面包屑/返回链接** (10min)
   - `articles/[id]/page.tsx` 中的 from=feed 逻辑

6. **验证与测试** (30min)
   - `pnpm dev` → 验证所有页面可访问
   - 验证导航跳转
   - 验证登录后落地页
   - 验证文章详情返回链接
   - Docker 部署测试

7. **可选：P2/P3 增强** (剩余时间)

---

## 五、不推荐的方案

- **保留 `/feed` + 重定向 `/` → `/feed`**：URL 多一层，不简洁
- **把所有内容堆在首页**：仪表盘和资讯流职责不同，混在一起信息过载
- **用客户端路由切换 Tab**：SEO 差，URL 不直观，不利于书签

**Why**: 用户每天打开系统第一个想看的是"有什么新情报"，而不是"系统采集了多少篇"。资讯流是核心价值交付页面，仪表盘是运维管理页面。让首页=核心价值交付，是最自然的 UX 设计。

**How to apply**: 按第四节的实施步骤，从 P0 路由重组开始，逐步执行。每完成一步在本地 `pnpm dev` 验证。
