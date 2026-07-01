# MVP 计划：Node.js 科技情报采集器 + Web 界面 + AI 沙盒

> 用 Node.js/TypeScript 实现，先在 **10 个代表性站点**上跑通完整闭环：
> **配置 → 采集 → 解析 → 入库(SQLite) → AI 分析与可用性审核 → Web 界面查看 / 人工复核**。
> 不需要回退 Python：Playwright 在 Node 是一等公民，Vercel AI SDK 本身就是 TS/JS 库。

---

## 0. 核心设计原则（来自你的第 4 点）

**确定性代码** 负责：权限、范围、持久化、通知、调度、采集、解析。
**LLM** 负责：质量控制、信息筛选（相关性判断、摘要、关键字段、可用性打分）。
**Vercel AI SDK 6** 充当"沙盒"：通过 受限输入 + 结构化输出(Zod) + 白名单工具集 + 参与度可配 来控制 AI 的介入程度。LLM 永远不直接碰数据库/网络/文件。

---

## 1. 技术栈（具体到包）

| 层 | 选型 | 理由 |
|----|------|------|
| 运行时 | Node.js 20+ / TypeScript | Playwright + AI SDK 的原生平台 |
| Web 框架 + UI | **Next.js (App Router)** + React + Tailwind + shadcn/ui | 一个进程同时提供后端 API 和 Web UI；AI SDK 6 对 Next.js 流式支持最好 |
| 静态采集 | 原生 `fetch`(undici) + **Cheerio** | 政府/静态站点 |
| 动态采集 | **Playwright** | 36氪/机器之心等 JS 渲染站点 |
| 并发/限流 | **p-queue**（按域名独立限流） | 避免把目标站点打挂，也避免撞自己的重复域名 |
| 调度 | **node-cron**（进程内） | MVP 够用；可被 UI 手动触发 |
| 数据库 | **SQLite** via `better-sqlite3` + **Drizzle ORM** | 零配置、类型安全、迁移管理 |
| AI | **Vercel AI SDK 6** (`ai`) + `@ai-sdk/anthropic`(默认 Claude) | 结构化输出、工具调用、可限制 step；provider 可经 env 切换 |
| 通知 | 可插拔 `Notifier` 接口，默认 log + 可选 webhook | MVP 不做邮件 |

---

## 2. 首批 10 个代表性站点（覆盖所有采集路径）

挑选标准：分类多样 + 难度多样（静态政府 / 政府CMS / 大流量门户 / 动态SPA / 强反爬），并兼顾你的青岛本地站点。

| # | 站点 | 分类 | 验证哪条路径 |
|---|------|------|--------------|
| 1 | 科学技术部 most.gov.cn | 国家级 | 静态政府 + 多 URL |
| 2 | 青岛市科技局 qdstc.qingdao.gov.cn | 山东市级 | 主流的 `.gov.cn/col/colXXXX/` CMS 模板（清单里大量重复） |
| 3 | 青岛高新区 gxq.qingdao.gov.cn | 科技园区 | 政府 CMS + 本地 |
| 4 | 青岛能源所 qibebt.cas.cn | 科研院所 | 静态 + 本地(中科院) |
| 5 | 科技日报 stdaily.com | 中央媒体 | 静态中央媒体 |
| 6 | 新浪科技 tech.sina.com.cn | 综合媒体 | 大流量门户 → 验证限流/去重 |
| 7 | 36氪 36kr.com | 综合媒体 | 现代 SPA → 验证 Playwright 动态路径 |
| 8 | IT之家 ithome.com | 综合媒体 | 解析结构多样性 |
| 9 | 量子位 qbitai.com | AI 媒体 | 主题核心(科技情报)，现代站点 |
| 10 | 机器之心 jiqizhixin.com | AI 媒体 | JS 重 + 反爬 → 最难的动态用例 |

覆盖：静态政府(1–5) / 大流量门户(6) / 动态 SPA(7,10) / 媒体解析多样性(8,9)。

---

## 3. 数据模型（SQLite，Drizzle 定义）

- **`sites`** —— 在现有 sites.json 基础上扩展：`id, name, category, subcategory, urls[], render(static|dynamic), list_selector, item_selector, title/body/date 选择器, interval(cron), ai_involvement(none|extract|extract_judge|full), enabled, last_run_at`
- **`articles`** —— `id, site_id, url(unique), title, body, published_at, status, fetched_at, content_hash(去重)`
  - `status`: `raw → analyzing → ready | rejected | review → published`
- **`ai_reviews`** —— `id, article_id, model, relevant(bool), summary, key_points[], tags[], quality_score(0–1), usable(bool), reason, tokens_used, created_at`（审计用）
- **`run_logs`** —— `id, site_id, started_at, ended_at, status, fetched/skipped/error 计数, message`

---

## 4. AI 沙盒设计（核心架构件）

每次 LLM 调用都被确定性代码包裹，强制以下边界：

1. **输入受限** —— 仅传入 文章标题 + 截断正文 + 该站点的 scope 定义；有大小上限。
2. **结构化输出** —— 用 `generateObject` + Zod schema，强制返回 `{ relevant, summary, keyPoints[], tags[], qualityScore, usable, reason }`。schema 校验失败 → 重试 → 仍失败标记 `analyze_error`。无自由文本逃逸。
3. **白名单工具集** —— 若 v2 允许 LLM 调工具（如"抓取相关链接"），只注册只读工具集 + `maxSteps` 限制循环。**v1 用纯 `generateObject`（无工具）= 最简沙盒**；工具留 v2。
4. **参与度旋钮（`ai_involvement`，按站点可配）**：
   - `none`：跳过 AI，纯确定性解析
   - `extract`：AI 仅做结构化/摘要，不做闸门
   - `extract_judge`（默认）：AI 同时给出 `usable` 可用性闸门
   - `full`：AI 可在多候选中择优（v2）
5. **人在回路** —— `qualityScore` 落在灰区(如 0.4–0.7) → 状态置 `review`，进 Web UI "待复核"队列人工 approve/reject。LLM 的 `usable` 只是**建议**，不是最终裁决。
6. **可观测** —— 每次 AI 调用记录 model/token/prompt/output 到 `ai_reviews`，可审计。

> 这就是"沙盒控制 AI 参与度"：**旋钮 + 硬性输入输出边界 + 白名单工具 + 确定性持久化**。代码始终是事实来源，LLM 只能在受限 sandbox 内做判断。

---

## 5. 主流程

```
调度器(cron) / UI 手动触发
  → 对每个 enabled 站点（按域名 p-queue 限流）
    → 抓取（静态 undici | 动态 Playwright）
    → 解析列表 → 条目(title/url/date)
    → 按 url + content_hash 去重
    → 新条目：解析正文
    → 入库 article(status=raw)
    → AI 沙盒闸门（按 ai_involvement）
       → generateObject → 写 ai_reviews
       → usable → ready/published ；灰区 → review ；不可用 → rejected
    → published 时：Notifier.fire(log/webhook)
  → 写 run_logs（计数/错误）
```

---

## 6. Web 界面（Next.js）

- `/` 仪表盘：各站点最近运行、成功率、各状态文章数；"立即采集"按钮
- `/sites` 站点配置：启用/禁用、编辑选择器 + ai_involvement + interval（CRUD `sites`）
- `/articles` 信息流：按站点/状态/标签过滤；卡片显示标题 + AI 摘要 + qualityScore + usable 徽章
- `/articles/[id]` 详情：左=原文正文，右=AI 分析(relevant/summary/keyPoints/tags/usable/reason)，底部 approve/reject
- `/review` 待复核队列（灰区条目）
- `/runs` 运行日志

---

## 7. 目录结构

```
tech-info-collector/
├── package.json, tsconfig.json, next.config, drizzle.config.ts
├── data/
│   ├── sites.seed.json     # 从现有 sites.json 取 10 个 enabled 种子
│   └── collector.db        # SQLite（gitignore）
├── db/
│   ├── schema.ts           # Drizzle schema
│   └── client.ts
├── src/
│   ├── crawler/
│   │   ├── fetcher.ts      # 静态(undici) + 动态(Playwright) 分发
│   │   ├── playwright.ts   # 浏览器池
│   │   └── parser.ts       # 选择器驱动抽取
│   ├── pipeline/
│   │   ├── runner.ts       # 编排 fetch→parse→persist→AI→notify
│   │   ├── dedup.ts
│   │   └── rate-limit.ts   # 按域名 p-queue
│   ├── ai/
│   │   ├── sandbox.ts      # 受限包装（输入上限/工具白名单/schema）
│   │   ├── analyze.ts      # generateObject 审核任务
│   │   └── schemas.ts      # Zod schema
│   ├── scheduler/cron.ts   # node-cron，加载 enabled 站点
│   ├── notify/notifier.ts  # 可插拔（log + webhook）
│   └── config/             # 加载/校验站点配置
├── app/                    # Next.js App Router
│   ├── (dashboard)…        # 上述页面
│   └── api/                # 触发采集 / 站点 CRUD / approve-reject
├── sites.json              # 保留为种子源（本阶段不改）
└── PLAN.md                 # 保留；本 MVP 计划取代之
```

---

## 8. 实施阶段（可逐段 checkpoint）

- **阶段 1 — 骨架与数据模型**：Next.js + Drizzle + SQLite，从 sites.json 种子 10 站点，空 UI 壳。✅ `pnpm dev` 跑起、DB 迁移成功。
- **阶段 2 — 确定性采集器**：fetcher(静态+Playwright)、选择器解析、按域名队列、去重、run_logs；为 10 站点手写选择器。✅ `pnpm crawl <siteId>` 能填充 `articles`(status=raw)，暂不接 AI。
- **阶段 3 — AI 沙盒**：sandbox 包装 + generateObject 审核 + 参与度旋钮 + 灰区 review 状态。✅ 文章能 raw→ready/rejected/review 并留 ai_reviews 记录。
- **阶段 4 — Web 界面**：仪表盘、站点 CRUD、文章流+详情+approve/reject、待复核队列、运行日志、手动触发。✅ 浏览器端到端可用。
- **阶段 5 — 调度+通知+收尾**：node-cron、notifier webhook stub、README，其余 93 站点种子但 `enabled=false`。✅ 定时任务能触发；10 站点 MVP 完成。

---

## 9. 明确不做（MVP 范围外，延后）

- 代理池 / Kafka / Redis / 横向扩展 Worker / Prometheus —— 对 103 个低频政府站点属过度设计
- 验证码识别 / 登录流程 —— 10 个站点都不需要；若机器之心等被封再议
- 其余 93 站点 —— 种子但禁用，写好选择器后逐个启用
- AI "full" 档（多候选择优）—— v2

---

## 10. 待确认假设（不阻塞，审阅时一并定）

- **AI provider**：默认 `@ai-sdk/anthropic`(Claude)，需 `ANTHROPIC_API_KEY`。若偏好国产模型(DeepSeek/通义)请告知，切换仅改 env + 一个 provider 文件。
- **通知**：MVP = 控制台 + 可选 webhook；暂不做邮件/短信。
