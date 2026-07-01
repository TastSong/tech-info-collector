# 科技情报采集器

Node.js/Typescript 对 **103 个中国科技情报网站** 进行自动化采集、结构化抽取，并用 **Vercel AI SDK + OpenAI 兼容 LLM** 做内容质量审核与可用性筛选。

> **当前版本：MVP（0.1）** — 9 站全量采集/审核已验证，完整 Web 管理界面，剩余 93 站种子已入库待启用。

---

## 架构

```
scheduler (cron) / Web UI 手动触发
  → 按域名限流采集（静态 fetch + Playwright 动态）
  → 选择器驱动列表/详情解析
  → 去重入库 (status=raw, SQLite)
  → AI 沙盒审核（LLM 建议 → 确定性闸门决定 ready/rejected/review）
  → Web 界面人工复核 / 发布
```

代码层职责：

| 层  | 确定性代码（负责）     | LLM（负责）              |
|-----|------------------------|--------------------------|
| 权限 | .env 控制 provider/模型 | —                        |
| 范围 | 输入硬截断 6000 字     | 按 scope 判相关性         |
| 持久化 | 写入 status+ai_reviews | 输出 summary/score 等建议  |
| 通知   | notifier webhook       | —                        |
| 质量控制 | —                  | usable / qualityScore 判定 |
| 最终决策 | `decideStatus()` 函数 | 仅是建议                   |

---

## 快速开始

```bash
# 1. 安装 + 编译原生模块（better-sqlite3 需 node-gyp）
pnpm install
pnpm add -D node-gyp         # 若尚未
pnpm rebuild better-sqlite3

# 2. 初始化数据库 + 种子
pnpm db:push
pnpm seed

# 3. 配置 .env（AI 审核网关）
cp .env.example .env
# 编辑 .env → 填入 AI_BASE_URL / AI_API_KEY / AI_MODEL

# 4. 开发
pnpm dev                     # http://localhost:3000（端口可能自动切换）

# 5. 采集 + 审核
pnpm crawl                   # 采集全部 enabled 站点
pnpm analyze                 # AI 审核所有 raw 文章
pnpm run                     # 采集 + 审核（一键）
```

---

## 可用命令

| 命令 | 说明 |
|------|------|
| `pnpm dev` | Next.js 开发服务器 |
| `pnpm build` / `pnpm start` | 生产构建/启动 |
| `pnpm db:push` | Drizzle schema → SQLite |
| `pnpm seed` | 导入 10 站点（含选择器） |
| `pnpm crawl [siteId]` | 采集（指定站点或不带参数=全部） |
| `pnpm analyze [--limit N]` | AI 审核 raw 文章 |
| `pnpm run` | crawl + analyze 一键 |
| `pnpm scheduler` | 启动 cron 定时调度 |

---

## 项目结构

```
├── app/                  # Next.js App Router (Web UI)
│   ├── layout.tsx        # 导航栏 + 全局布局
│   ├── page.tsx          # 仪表盘（文章数/运行日志/站点概览）
│   ├── articles/         # 文章流 + 详情（含 AI 审核面板）
│   ├── review/           # 待人工复核队列
│   ├── sites/            # 站点配置一览
│   ├── runs/             # 运行日志
│   └── api/              # approve/reject + 手动采集触发
├── db/
│   ├── schema.ts         # Drizzle ORM 表定义（sites/articles/ai_reviews/run_logs）
│   └── client.ts         # better-sqlite3 + WAL 连接
├── data/
│   ├── sites.seed.json   # 10 个 MVP 站点种子（含选择器）
│   └── collector.db      # SQLite 数据库（gitignore）
├── src/
│   ├── crawler/          # fetcher（静态+Playwright）、parser、rate-limit、探针
│   ├── pipeline/         # 采集 runner、去重、CLI
│   ├── ai/               # 沙盒（sandbox）+ 审核批处理（analyze）
│   ├── scheduler/        # node-cron 定时调度
│   ├── notify/           # 可插拔通知器（console + webhook）
│   └── config/           # 种子脚本
├── sites.json            # 原 103 站点清单（源数据）
├── .env.example          # 环境变量模板
└── PLAN.md               # 原始架构设计（参考文档）
```

---

## 环境变量

| 变量 | 必填 | 默认 | 说明 |
|------|------|------|------|
| `AI_BASE_URL` | ✓ | — | OpenAI 兼容 API 端点 |
| `AI_API_KEY` | ✓ | — | API 密钥 |
| `AI_MODEL` | ✓ | — | 模型名（如 `deepseek-chat`） |
| `AI_TIMEOUT_MS` | | `60000` | 单次 AI 调用超时（毫秒） |
| `AI_REVIEW_LOW` | | `0.4` | qualityScore 低于此 → rejected |
| `AI_REVIEW_HIGH` | | `0.7` | qualityScore 高于此 → ready |
| `NOTIFY_WEBHOOK_URL` | | — | 采集完成通知 webhook |
| `CRON_INTERVAL` | | `0 */6 * * *` | 定时调度频率 |

---

## 如何新增站点

1. 在 `data/sites.seed.json` 中添加一条（或直接 INSERT `sites` 表）
2. 用 `pnpm tsx src/crawler/inspect.ts <siteId>` 摸清列表结构
3. 填入 `list_selector` / `link_selector` / `body_selector`（body 可选，有通用回退）
4. 设 `enabled: true`，跑 `pnpm crawl <siteId>` 验证

---

## MVP 已采集站点（9/10 有效）

| # | 站点 | 类型 | 选择器 |
|---|------|------|--------|
| 1 | 科学技术部 | static | `li.mhide` |
| 2 | 青岛市科技局 | static | `div.swiper-slide` |
| 3 | 青岛高新区 | static | `td` |
| 4 | 青岛能源所 | static | `h4` |
| 5 | 科技日报 | static | `div.kjxwTit` |
| 6 | 新浪科技 | static | `ul.news-list li` |
| 7 | 36氪 | dynamic | `p.title-wrapper` |
| 8 | IT之家 | static | `li.n` |
| 9 | 量子位 | static | `h4` |
| 10 | 机器之心 | dynamic | 待优化（禁用） |
