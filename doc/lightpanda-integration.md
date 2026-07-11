# Lightpanda 接入方案

> 为 Tech-Info-Collector **新增** Lightpanda 无头浏览器作为第三种采集引擎。
> **原有的 `static`（原生 HTTP）和 `dynamic`（Playwright Chromium）完全保留、不受任何影响。**

---

## 一、背景与动机

### 现状

当前项目对 `render=dynamic` 的站点使用 **Playwright + Chromium** 进行 JS 渲染抓取：

| 指标 | Playwright Chromium (当前) |
|:-----|:--------------------------|
| 内存峰值 (100 页) | ~2 GB |
| 执行时间 (100 页) | ~46s |
| Docker 镜像体积 | ~1.5 GB（含 Chromium） |
| 并发限制 | 受内存约束，仅 2-3 个 dynamic 站点并行 |

### Lightpanda 收益

| 指标 | Lightpanda | 改善 |
|:-----|:----------|:-----|
| 内存峰值 (100 页) | **123 MB** | **~16x 降低** |
| 执行时间 (100 页) | **5s** | **~9x 加速** |
| Docker 镜像体积 | ~150 MB | **~10x 减小** |
| 并发能力 | 内存不再是瓶颈 | **可安全提高到 10+** |

### 风险提示

- Lightpanda 是 Zig 全新实现的浏览器，**不是 Chromium fork**，对重度 JS/SPA 站点的兼容性可能不如 Chromium
- 项目仍在活跃开发中（AGPL-3.0 协议），API 可能变动
- 某些依赖 Chromium 特有 API（如 `page.evaluate`、复杂事件模拟）的场景可能不工作

---

## 二、总体策略：新增采集引擎，原引擎不受影响

### 核心原则

> **Lightpanda 是新增的第三种采集方式，不是替代品。**
> `static` 和 `dynamic` 模式的行为、代码、配置均保持不变。
> 仅当站点显式设置 `render = "lightpanda"` 时才会走新引擎。

```
            ┌─────────────┐
            │  fetchHtml() │
            └──────┬──────┘
                   │
         ┌─────────┴──────────┐
         │  render mode       │
         ├────────────────────┤
         │ "static"           │ → 原生 http/https (不变)
         │ "lightpanda"  NEW  │ → Lightpanda CDP
         │ "dynamic"          │ → Playwright (保留，降级回退)
         └────────────────────┘
```

1. **新增 `render="lightpanda"`** — 作为第三种渲染引擎，面向适合 Lightpanda 的站点
2. **完全保留 `render="static"` 和 `render="dynamic"`** — 行为、代码、配置零变更，已配置的站点无需任何修改
3. **默认值不变** — 新建站点的默认 render 值仍然是 `"static"`，不会自动切换到 lightpanda
4. **自动降级（可选）** — `lightpanda` 模式的请求失败时，可通过配置自动回退到 Playwright
5. **DB 兼容** — 新增 render 枚举值，现有数据零影响

---

## 三、架构变更点

### 3.1 文件变更一览

| 文件 | 操作 | 说明 |
|:-----|:-----|:-----|
| `docker-compose.yml` | **修改** | 新增 lightpanda 服务 |
| `Dockerfile` | **不变** | Playwright + Chromium 完整保留 |
| `src/crawler/lightpanda.ts` | **新增** | Lightpanda CDP 客户端 |
| `src/crawler/fetcher.ts` | **修改** | 新增 `lightpanda` 分支（`static`/`dynamic` 分支不动） |
| `src/crawler/playwright.ts` | **不变** | 保持原样 |
| `src/pipeline/service.ts` | **修改** | 增加 lightpanda 连接回收 |
| `db/schema.ts` | **修改** | render 枚举增加 `"lightpanda"` |
| `.env.example` | **修改** | 新增 Lightpanda 相关配置 |

### 3.2 数据流（变更后）

```
CLI / Cron / Web API
  │
  ▼
runCrawl()                    service.ts
  │
  ▼
runSite()                     runner.ts
  │
  ▼
intelligentCrawl()            intelligent-crawl.ts
  │
  ├─► fetchHtml(url, render)  fetcher.ts
  │     │
  │     ├─ "static"    → nativeFetch()           (原生 http/https)
  │     ├─ "lightpanda"→ fetchWithLightpanda()    (NEW: CDP)
  │     └─ "dynamic"   → fetchDynamic()           (Playwright, 保留)
  │
  └─► parseDetail()            parser.ts           (Cheerio, 不变)
```

---

## 四、详细实现

### 4.1 Docker Compose：新增 Lightpanda 服务

```yaml
# docker-compose.yml
services:
  app:
    # ... 现有配置保持不变 ...
    environment:
      - LIGHTPANDA_WS_ENDPOINT=ws://lightpanda:9222
    depends_on:
      - lightpanda

  lightpanda:
    image: lightpanda/browser:nightly
    container_name: tech-info-lightpanda
    command: serve --host 0.0.0.0 --port 9222 --obey-robots
    ports:
      - "127.0.0.1:9222:9222"  # 仅本地访问
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "lightpanda", "version"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 5s
    # Lightpanda 自身内存极小，无需限制
```

### 4.2 新增：Lightpanda CDP 客户端 (`src/crawler/lightpanda.ts`)

```typescript
/**
 * Lightpanda 浏览器客户端 — 通过 CDP WebSocket 协议连接。
 *
 * 与 playwright.ts 保持相同接口签名，方便 fetcher.ts 统一调用。
 * Lightpanda 自带连接池（服务端多路复用），无需客户端 browser pool。
 */
import { type Browser, type Page } from "playwright";
import { chromium } from "playwright";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/** Lightpanda CDP WebSocket 地址 */
function getEndpoint(): string {
  return process.env.LIGHTPANDA_WS_ENDPOINT ?? "ws://127.0.0.1:9222";
}

let browser: Browser | null = null;

/** 连接到 Lightpanda CDP 服务器，复用连接 */
export async function getLightpandaBrowser(): Promise<Browser> {
  if (!browser || !browser.isConnected()) {
    const wsEndpoint = getEndpoint();
    console.log(`  🔌 connecting to Lightpanda: ${wsEndpoint}`);
    browser = await chromium.connect(wsEndpoint);
  }
  return browser;
}

/** 使用 Lightpanda 抓取页面 HTML */
export async function fetchWithLightpanda(
  url: string,
  opts: { timeoutMs?: number; waitSelector?: string } = {},
  externalSignal?: AbortSignal,
): Promise<string> {
  const browser = await getLightpandaBrowser();
  const context = await browser.newContext({
    userAgent: UA,
    locale: "zh-CN",
  });
  const page = await context.newPage();

  try {
    // Lightpanda 支持的 waitUntil 值与 Chromium 一致 (CDP 兼容)
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: opts.timeoutMs ?? 30_000, // Lightpanda 更快，可设更低超时
    });

    if (opts.waitSelector) {
      await page
        .waitForSelector(opts.waitSelector, { timeout: 10_000 })
        .catch(() => {});
    } else {
      await page
        .waitForLoadState("networkidle", { timeout: 10_000 })
        .catch(() => {});
    }

    // Lightpanda 渲染很快，减少等待时间
    await page.waitForTimeout(300);

    return await page.content();
  } finally {
    await context.close();
  }
}

/** 断开 Lightpanda CDP 连接 */
export async function closeLightpanda(): Promise<void> {
  if (browser) {
    await browser.close().catch(() => {});
    browser = null;
  }
}
```

### 4.3 修改：Fetcher 增加 Lightpanda 分支 (`src/crawler/fetcher.ts`)

```typescript
// 在现有 import 后新增：
import { fetchWithLightpanda } from "./lightpanda";

// RenderMode 类型扩展：
export type RenderMode = "static" | "dynamic" | "lightpanda";

// fetchHtml() 中增加分支：
export async function fetchHtml(
  url: string,
  mode: RenderMode,
  opts: FetchOpts = {},
  externalSignal?: AbortSignal,
): Promise<string> {
  if (mode === "lightpanda") {
    return fetchWithLightpanda(url, opts, externalSignal);
  }
  if (mode === "dynamic") return fetchDynamic(url, opts, externalSignal);
  // ... static 逻辑不变 ...
}
```

### 4.4 修改：Service 层连接管理 (`src/pipeline/service.ts`)

```typescript
// 新增 import
import { closeLightpanda } from "../crawler/lightpanda";

// runCrawl() 末尾，在 closeBrowser() 之后增加：
await closeLightpanda().catch(() => {});
```

### 4.5 修改：DB Schema (`db/schema.ts`)

```typescript
// sites 表的 render 字段枚举扩展：
render: text("render", { enum: ["static", "dynamic", "lightpanda"] })
  .notNull()
  .default("static"),
```

### 4.6 新增环境变量 (`.env.example`)

```bash
# ── Lightpanda 无头浏览器（替代 Playwright，节省 90%+ 内存）──
# CDP WebSocket 地址（Docker 内自动使用服务名 lightpanda）
LIGHTPANDA_WS_ENDPOINT=ws://127.0.0.1:9222
# Lightpanda 请求超时 ms（默认 30s，比 Playwright 更低因为 Lightpanda 更快）
# LIGHTPANDA_TIMEOUT_MS=30000
# Lightpanda 失败时是否自动回退到 Playwright（默认 true）
# LIGHTPANDA_FALLBACK_TO_PLAYWRIGHT=true
```

### 4.7 Dockerfile（保持不变）

**现有 Dockerfile 无需修改。** Playwright Chromium 及其系统依赖完整保留，继续为 `dynamic` 模式的站点服务。

Lightpanda 作为独立的 Docker 服务（sidecar）运行，与 app 容器并行。内存占用大幅降低的原因是：
- Lightpanda 自身内存仅 ~50MB（对比 Chromium 的 ~1.5GB）
- Chromium 仍安装在容器中，但仅 `dynamic` 站点会触发其启动
- 大部分站点可以直接使用 `static` 模式，少数 JS 渲染站点按需选择 `lightpanda` 或 `dynamic`

---

## 五、实施路径

### 5.1 阶段一：基础设施搭建（本次 PR）

1. 新增 `docker-compose.yml` 中 lightpanda 服务
2. 新增 `src/crawler/lightpanda.ts`
3. 修改 `fetcher.ts`（新增一个 `lightpanda` 分支，`static`/`dynamic` 分支代码不动）、`service.ts`、`db/schema.ts`
4. 更新 `.env.example`
5. 本地测试验证

### 5.2 阶段二：试点验证（1-2 周）

选择 2-3 个站点验证 Lightpanda 的兼容性，在数据库中将它们的 render 值从 `dynamic`（或 `static`）改为 `lightpanda`：

```sql
-- 示例：将某个站点切换为 lightpanda 试跑
UPDATE sites SET render = 'lightpanda' WHERE id = <site_id>;
```

观察指标：
- 页面渲染是否完整（正文是否缺失）
- 链接提取准确率对比
- 抓取速度提升
- 错误率

### 5.3 阶段三：按需推广

试点验证通过后，根据站点特征决定哪些适合切换：

```sql
-- 将 JS 渲染较简单的 dynamic 站点批量切换（保留重型 SPA 站点继续用 dynamic）
UPDATE sites SET render = 'lightpanda'
WHERE render = 'dynamic'
  AND name NOT IN ('heavy-spa-site-1', 'heavy-spa-site-2');
```

对每个站点而言，`render` 字段的三个值是平等的——根据站点特征选择最合适的引擎：

| 站点特征 | 推荐 render |
|:---------|:-----------|
| 纯服务端渲染、无 JS 依赖 | `static`（最快，零资源） |
| 轻度 JS 渲染、列表懒加载 | `lightpanda`（快 + 省内存） |
| 重度 SPA、Canvas/WebGL、复杂交互 | `dynamic`（最兼容） |

### 5.4 长期维护

三种渲染引擎长期共存，**不会移除 Playwright**：
- `playwright.ts` 保持在代码库中，为 `dynamic` 站点服务
- Dockerfile 中的 Chromium 保留，确保 `dynamic` 模式随时可用
- Lightpanda 作为推荐选项，但始终保留 `static` 和 `dynamic` 两种回退路径

---

## 六、自动降级策略（可选增强）

在 `fetcher.ts` 中实现自动回退：

```typescript
export async function fetchHtml(
  url: string,
  mode: RenderMode,
  opts: FetchOpts = {},
  externalSignal?: AbortSignal,
): Promise<string> {
  if (mode === "lightpanda") {
    try {
      return await fetchWithLightpanda(url, opts, externalSignal);
    } catch (e) {
      const fallback = process.env.LIGHTPANDA_FALLBACK_TO_PLAYWRIGHT !== "false";
      if (fallback) {
        console.log(`  ⚠ Lightpanda 失败，回退 Playwright: ${url}`);
        return await fetchDynamic(url, opts, externalSignal);
      }
      throw e;
    }
  }
  // ...
}
```

---

## 七、测试验证

### 7.1 冒烟测试

```bash
# 1. 启动服务
docker compose up -d --build

# 2. 验证 Lightpanda 健康
docker compose exec lightpanda lightpanda version

# 3. 单独页面抓取
docker compose exec app node -e "
  const { fetchWithLightpanda } = require('./src/crawler/lightpanda');
  fetchWithLightpanda('https://example.com').then(h => console.log(h.slice(0,200)));
"

# 4. 切换一个站点为 lightpanda 后采集
docker compose exec app pnpm crawl <site_id>

# 5. 对比前后数据：正文长度、标题完整性
docker compose exec app pnpm db:studio
```

### 7.2 对比测试脚本

```bash
#!/bin/bash
# scripts/test-lightpanda-vs-playwright.sh
# 对同一个 URL 分别用 lightpanda 和 playwright 抓取，对比结果

URL=$1
echo "=== Lightpanda ==="
time curl -s "http://localhost:4040/api/test-fetch?url=$URL&render=lightpanda" | jq '.bodyLength, .title'
echo "=== Playwright ==="
time curl -s "http://localhost:4040/api/test-fetch?url=$URL&render=dynamic" | jq '.bodyLength, .title'
```

### 7.3 关键验证项

| 验证项 | 方法 | 通过标准 |
|:-------|:-----|:--------|
| HTML 结构完整性 | 对比抓取的 DOM 节点数 | ≥ Playwright 的 80% |
| 正文文本完整性 | 对比 parseDetail 后 body 长度 | ≥ Playwright 的 90% |
| 链接提取准确率 | 对比列表页链接数 | ≥ Playwright 的 90% |
| 中文渲染 | 检查 charset/乱码 | 无乱码 |
| 内存峰值 | `docker stats` | < 500 MB (含 app) |
| 抓取耗时 | 日志对比 | 减少 50%+ |

---

## 八、兼容性矩阵

| 站点类型 | Lightpanda 兼容性 | 建议 |
|:---------|:-----------------|:-----|
| 服务端渲染 (SSR) 页面 | ✅ 完全支持 | 用 `static` 模式即可 |
| 轻度 JS 渲染 (列表懒加载) | ✅ 大概率支持 | 试点后切换 |
| Vue/React SPA (CSR) | ⚠️ 可能部分支持 | 试点验证，必要时保留 `dynamic` |
| Canvas/WebGL 图表 | ❌ 不支持 | 保留 `dynamic` |
| 复杂表单/登录流程 | ❌ 不支持 | 本项目不涉及 |
| 反爬严格站点 (TLS fingerprint) | ⚠️ 不确定 | 对比测试 |

---

## 九、回滚方案

如果 Lightpanda 出现严重兼容性问题：

1. **站点级回退**：`UPDATE sites SET render = 'dynamic' WHERE render = 'lightpanda';`
2. **代码级回退**：Git revert 本次 PR
3. **服务级回退**：`docker compose stop lightpanda`，现有 `dynamic` 站点不受影响

---

## 十、参考资源

- [Lightpanda GitHub](https://github.com/lightpanda-io/browser)
- [Lightpanda 官方文档](https://lightpanda.io/docs)
- [CDP 协议兼容性](https://lightpanda.io/docs/usage/cdp)
- [Docker 镜像](https://hub.docker.com/r/lightpanda/browser)
