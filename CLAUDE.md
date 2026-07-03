# tech-info-collector — CLAUDE.md

## 项目概览

基于 Next.js 的科技情报采集器，定时抓取配置的站点内容，通过 AI 生成摘要，提供资讯流展示。

- **框架**: Next.js 15 (App Router) + React 19 + TypeScript
- **数据库**: SQLite (`better-sqlite3`) + Drizzle ORM
- **采集**: Playwright (动态渲染) + Cheerio (静态解析)
- **AI**: Vercel AI SDK + OpenAI-compatible API
- **调度**: node-cron
- **样式**: Tailwind CSS 4
- **包管理**: pnpm
- **容器化**: Docker + docker-compose

## 常用命令

```bash
pnpm dev              # 开发服务器 (端口 4040)
pnpm build            # 生产构建
pnpm start            # 生产启动
pnpm typecheck        # TypeScript 类型检查
pnpm db:push          # 数据库 schema 推送
pnpm db:studio        # Drizzle Studio
pnpm seed             # 初始化种子数据
pnpm crawl            # 执行站点采集
pnpm analyze          # 触发 AI 分析
pnpm run              # crawl + analyze 一次执行
pnpm scheduler        # 启动定时调度器
```

## 目录结构

```
app/              Next.js 页面和组件
src/              核心逻辑 (pipeline, AI, scheduler, config)
db/               数据库 client 和 schema
data/             运行时数据 (collector.db, sites.seed.json)
scripts/          构建/部署脚本
docker-compose.yml / Dockerfile   容器化部署
```

## 数据库

SQLite 文件: `data/collector.db`（含 WAL 文件 `collector.db-wal`, `collector.db-shm`）

## Docker

- 镜像名: `tech-info-collector:latest`
- 容器名: `tech-info-collector`
- 端口映射: `4040:4040`
- 数据卷: `collector_data` → `/app/data`

### 🐳 部署与测试策略

**默认使用 Docker 进行所有部署和测试，除非用户明确要求本地部署。**

- 部署：`docker compose up -d --build` 或先 `docker build` 再 `docker compose up -d`
- 测试：在容器内执行命令，如 `docker compose exec app pnpm crawl`
- 日志：`docker compose logs -f`
- 重启：`docker compose restart`
- 仅在用户明确说"本地部署"、"本地运行"、"不用 docker"时，才使用 `pnpm dev` / `pnpm start`

---

## ⛔ 安全红线 (Safety Rules)

### 禁止删除的范围

**无论如何、任何情况下，不得删除以下内容：**

1. **本项目之外的文件** — 不可 `rm`、`rm -rf` 任何项目目录 (`/Users/wang/Desktop/tech-info-collector/`) 之外的文件或目录。包括但不限于 `~`、`/tmp`、`/etc`、其他项目目录等。

2. **项目数据库** — 禁止删除或清空 `data/collector.db` 及其 WAL 辅助文件 (`data/collector.db-wal`, `data/collector.db-shm`)，除非用户明确要求重建数据库。

3. **Docker 镜像** — 禁止删除以下 Docker 镜像（用 `docker rmi`、`docker image rm`、`docker system prune` 等）：
   - `tech-info-collector:*`
   - 系统上任何其他 Docker 镜像（如 `mediary-scout-web`, `postgres`, `pansou-web`, `fatedier/frpc` 等）

4. **Docker 容器** — 禁止删除运行中或有数据的容器。允许 `docker compose down`（停止容器），但禁止带 `--volumes` 删除数据卷（除非用户明确要求）。

### 可执行的范围

- ✅ 使用 `pnpm`、`node`、`tsx` 执行项目内脚本
- ✅ 读写项目目录内的文件
- ✅ `docker compose up/down/restart`（不带 `--volumes`）
- ✅ `docker build` 构建项目镜像
- ✅ 读写 `/tmp` 下的临时文件（仅供调试/日志用途）
- ✅ `git` 操作（仅在项目仓库内）

### 破坏性操作确认

在执行以下操作前，**必须先向用户确认**：
- 删除任何项目源码文件（非临时文件）
- `git push --force` 或改写历史
- 修改 `docker-compose.yml` 中的 volumes 配置
- `docker system prune` 或类似清理命令
