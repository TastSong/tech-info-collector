# S18 智能爬虫方案 — 优缺点分析与改进方案

> 分析日期: 2026-07-04
> 源方案: doc/suggestions/S18-intelligent-crawler.md

---

## 第一部分：优点

### 1. 解决真实痛点

当前 `runner.ts:78` 对 `listSelector IS NULL` 的站点直接抛错跳过，方案以这些站点为 Phase 1 目标（"从跳过变为能采"），风险低、收益明确。

### 2. 架构集成干净

- 复用 AI SDK 的 `generateText` + `tools` + `maxSteps`，不引入新的 LLM 调用框架
- 在 `runner.ts` 的 `runSite()` 中做分支，后续的去重/contentHash/写入DB 完全复用
- `fetch_page` 工具设计了缓存层，避免同一会话内重复抓取

### 3. 分阶段推进策略合理

4 个 Phase 从"仅补充无选择器站点"到"完全取代选择器"，每个阶段有明确的降低风险手段。

### 4. HTML 清洗考虑周全

- 去除 script/style/noscript/iframe/svg/注释
- 去除常见导航/侧边栏/广告区域
- 500KB 硬上限防止 token 爆炸
- 这些措施同时降低了 prompt injection 风险

### 5. 成本可控

- `maxSteps=10` + `maxTokens` 环境变量提供硬上限
- 120s 总超时防止单站点阻塞整个采集
- 环境变量开关允许按需启用

### 6. 对现有流程零侵入

选择器路径的代码完全不动，功能开关控制，出问题可立即回退。

---

## 第二部分：缺点与问题

### 问题 1（严重）：结果提取是未实现的 TODO

**现状**：

方案 §五 `intelligentCrawl()` 的返回值中：

```typescript
return {
  articles: [], // TODO: 从 tool 调用历史中提取
  ...
};
```

**分析**：

AI SDK v7 的 `generateText` 在 `maxSteps > 0` 时，`output` 是最后一步 LLM 返回的文本，`steps` 数组记录了每步的 tool 调用和结果。方案没有说明：

- 如何从 `steps` 中重建文章列表（哪些 step 是 `extract_article`？参数和返回值如何关联？）
- 如何让 LLM 在最后一步输出一个 JSON 汇总（未使用 `output.object()` 或 `output.schema()`）
- 如果 LLM 中途放弃（提取了 5 篇就停了），如何拿到 partial 结果

这与 S01 方案（已使用结构化输出）的设计水平差距明显。

### 问题 2（严重）：三个 Tool 的定位存在根本性混淆

**现状**：

方案声称使用 "tool-calling" 让 LLM 自主分析 DOM 结构。但实际三个 tool 中：

| Tool | 实际执行 | LLM 的角色 |
|---|---|---|
| `fetch_page` | 真实的 tool——抓取 HTML 返回给 LLM | 查看返回的 HTML |
| `extract_list_items` | **确定性 Cheerio 代码**——统计父元素 class、找出现最多的容器模式 | 仅传入 `html` 和可选 `hint`，无法干预提取逻辑 |
| `extract_article` | **确定性 Cheerio 代码**——找 h1、找 p 最多的容器 | 仅传入 `url`，无法干预提取逻辑 |

**关键矛盾**：

`extract_list_items` 和 `extract_article` 的 `execute` 函数是**预先写死的规则**，LLM 只能决定"何时调用"它们，不能决定"如何提取"。这等价于：

```
LLM 看到 HTML → 调用 extract_list_items(html) → Cheerio 执行固定规则 → 返回结果
```

但方案宣传的架构是：

```
LLM 看到 HTML → 分析 DOM 结构 → 自主决定如何提取
```

LLM 在这里只是一个"路由决策者"（先调 fetch_page，再调 extract_list_items，再调 extract_article），它看不到 `extract_list_items` 的内部执行过程，也无法优化提取策略。**这不是真正的 tool-calling 爬虫，而是一个披着 tool-calling 外壳的固定规则爬虫。**

### 问题 3（中）：`extract_list_items` 启发式规则脆弱

```typescript
// 策略 1：找所有 <a> 标签，统计父元素的 CSS class/tag 模式
// 找出出现次数最多的容器模式（即是文章列表）
const sorted = [...containerStats.entries()]
  .filter(([_, v]) => v.count >= 3)
  .sort((a, b) => b[1].count - a[1].count);
```

这个策略在以下场景会失败：

- **BEM/utility-first CSS**（如 Tailwind）：每个 item 的 class 完全相同，但 container 的 class 也完全相同，无法区分
- **嵌套列表**：如果页面同时有"导航栏链接列表"和"文章列表"，`<li>` 可能是出现最频繁的容器
- **动态渲染站点**：列表项没有统一的 class pattern（如 React 生成的随机 class）
- **多栏目页面**：侧边栏"热门文章"可能被误识别为主列表

### 问题 4（中）：`extract_article` 与现有 `parseDetail` 重复

对比：

| 功能 | `extract_article`（新） | `parseDetail`（现有） |
|---|---|---|
| 标题提取 | h1 → title 回退 | titleSelector 优先 → h1 → title 回退 |
| 正文提取 | 找 article/.content 等 → p 最多的容器 | bodySelector 优先 → p 最多的容器 |
| 日期提取 | 正则匹配页面 | dateSelector 优先 |
| 清理 | 基础清理 | 去 script/style/nav 等 |

两者逻辑几乎相同。方案新增了约 100 行重复代码，而没有抽取公共逻辑。

### 问题 5（中）：性能倒退

| 维度 | 当前选择器方案 | 智能爬虫方案 |
|---|---|---|
| 列表提取 | Cheerio 直接解析（~0.1s） | LLM 推理 + 1 次 tool 调用（~3-10s） |
| 单篇文章 | Cheerio 直接解析（~0.1s） | LLM 推理 + 1 次 tool 调用（~3-10s） |
| 并行 | 15 篇文章并行抓取 | LLM 单步顺序处理（每步 1 篇文章） |
| 总耗时（15篇） | ~15-30s | ~60-120s（受 maxSteps 限制） |

智能爬虫最大问题是**无法并行**——LLM tool-calling 是顺序的（每步都要等 LLM 推理后决定下一步），而当前方案用 `Promise.allSettled` 并行抓取所有详情页。

### 问题 6（中）：未使用现有基础设施

方案从头实现了：
- 独立的 `SessionCache`（而非复用通用缓存）
- 独立的 `fetchStatic`/`fetchDynamic`（而非直接复用 `fetcher.ts` 的 `fetchHtml`）
- 独立的 HTML 清洗（而非复用 `parser.ts` 的 `cleanHtml` 逻辑）

虽然有"会话级缓存"的理由，但 `fetch_page` 的实现完全可以是对现有 `fetchHtml()` 的薄封装。

### 问题 7（低）：成本分析低估了实际情况

方案估算单站点 ~8-12 万 tokens。但实际 tool-calling 场景下：

- **HTML 作为 tool 返回值会被计入 context**：一个列表页 HTML 清洗后通常 50-300KB，折合 15-75K tokens
- **每篇详情页 HTML** 清洗后 10-100KB，折合 3-30K tokens
- **LLM 的推理步骤**（每一步都产生中间 token）
- **tool 调用的 input/output schema JSON** 也计入 context

更真实的估算：列表页 20K + 15 篇详情 × 15K = 245K tokens，加上推理和 tool schema，**单站点可能需要 30-50 万 tokens**。

### 问题 8（中）：无上下文窗口溢出防护

`generateText` 的 context 是所有 step 的累积。如果有 15 篇文章详情 HTML 都在 context 中，加上每步 tool call 的 JSON，单站点的累积 context 可能达到 400K+ tokens。许多模型的 context 窗口是 128K，**在提取第 5-6 篇文章时就会溢出**。

方案没有提到：
- 如何管理 context（例如要求 LLM 在提取信息后丢弃 HTML）
- 哪些模型支持多步 tool-calling 的大 context
- context 溢出时的降级策略

### 问题 9（中）：安全风险未彻底消除

虽然 HTML 清洗去除了 `<script>` 等标签，但：

- **可见文本中的 prompt injection**：页面 `<h1>` 可能包含类似 "Ignore all previous instructions" 的文本
- **title/meta 注入**：`<title>` 和 `<meta>` 的内容直接暴露给 LLM
- **URL 注入**：URL path 可能包含恶意指令文本

这些不在 cleanup 范围内。方案对此无任何防护。

### 问题 10（低）：缺少去重与 rate-limiting 集成

智能爬虫路径没有使用现有的 `queueFor()` 域名限流器。如果 LLM 决定密集抓取同一域名的多个页面，可能触发目标站点的反爬机制。

### 问题 11（低）：验证指标不完整

方案 §10.3 的验收标准缺少：
- 误提取率（非文章页面被当作文本提取）的测试方法
- 对动态渲染站点（需要 Playwright）的专门测试
- 回归测试（确保选择器路径不受影响）
- 边界测试（单页应用、空页面、纯图片页面、PDF 链接等）

---

## 第三部分：修改方案

### 修改 1（核心）：重新定义 Tool 的职责边界

**问题**：`extract_list_items` 和 `extract_article` 本质上是固定规则，LLM 只是路由器。

**修改**：将 Tool 重新设计为**真正的 LLM 驱动提取**：

```
fetch_page(url)           → 返回清洗后的 HTML 文本（保持不变）
analyze_page(html, goal)  → LLM 分析 HTML，返回发现的模式和提取策略（新增）
extract_items(strategy)   → 按 LLM 指定的策略执行确定性提取（改造）
```

关键变化：

- **删除 `extract_list_items`**（固定规则版）
- **新增 `analyze_page`**：让 LLM 真正"看"HTML，输出找到的**CSS 选择器/模式描述**，例如：
  ```json
  {
    "listPattern": {
      "containerSelector": "div.news-list > ul > li",
      "linkPattern": "a[href^='/article/']",
      "titleSelector": "h3.title",
      "dateSelector": "span.date",
      "itemCount": 20
    }
  }
  ```
- **改造 `extract_items`**：接收 LLM 输出的 `listPattern`，执行**确定性选择器提取**（复用现有的 `parseList` 逻辑）
- **新增 `extract_article_content`**：让 LLM 看到详情页 HTML 后，指定正文容器选择器，再由 Cheerio 执行提取

这样的分工才是真正的 tool-calling：**LLM 负责"分析"（我说了算），确定性代码负责"执行"（你说了算）**。

### 修改 2（核心）：补全结果提取逻辑

**问题**：`articles: []` 是 TODO。

**修改**：

```typescript
export async function intelligentCrawl(input: {
  siteUrl: string;
  siteName: string;
  scope: string | null;
  render: "static" | "dynamic";
}): Promise<IntelligentCrawlResult> {
  const sessionCache = new SessionCache();
  const extractedArticles: Map<string, ArticleData> = new Map();

  const result = await generateText({
    model: getModel(),
    temperature: 0.1,
    maxSteps: 10,
    system: `...`,
    prompt: `...`,
    tools: {
      fetch_page: { /* ... */ },
      analyze_page_structure: {
        description: "分析页面 HTML 结构，找到文章列表的模式",
        inputSchema: z.object({
          html: z.string(),
          goal: z.enum(["find_article_list", "find_article_body"]),
        }),
        execute: async ({ html, goal }) => {
          // LLM 直接分析 HTML，返回发现的选择器和模式
          // 这里使用轻量级 LLM 调用来分析 DOM 结构
          const analysis = await analyzePageStructure({ html, goal });
          return analysis;
        },
      },
      extract_items_with_strategy: {
        description: "使用 LLM 分析出的选择器策略提取列表项",
        inputSchema: z.object({
          html: z.string(),
          baseUrl: z.string(),
          strategy: z.object({
            containerSelector: z.string(),
            linkSelector: z.string().optional(),
            titleSelector: z.string().optional(),
            dateSelector: z.string().optional(),
          }),
        }),
        execute: async ({ html, baseUrl, strategy }) => {
          // 确定性执行：复用现有 parseList
          return parseList(html, baseUrl, strategy);
        },
      },
      extract_article_content: {
        description: "从详情页 HTML 中提取文章内容",
        inputSchema: z.object({
          url: z.string(),
          html: z.string(),
          titleSelector: z.string().optional(),
          bodySelector: z.string().optional(),
        }),
        execute: async ({ url, html, titleSelector, bodySelector }) => {
          const article = parseDetail(html, {
            listSelector: null,
            linkSelector: null,
            titleSelector: titleSelector ?? null,
            bodySelector: bodySelector ?? null,
            dateSelector: null,
          });
          extractedArticles.set(url, article);
          return article;
        },
      },
    },
    // 关键：使用结构化输出约束最终结果
    output: object({
      schema: z.object({
        articles: z.array(z.object({
          url: z.string(),
          title: z.string(),
          date: z.string().nullable(),
        })),
        summary: z.string(),
      }),
    }),
  });

  return {
    articles: Array.from(extractedArticles.values()),
    extractionMethod: "tool-calling",
    stats: {
      pagesFetched: sessionCache.size,
      listItemsFound: result.output.articles.length,
      articlesExtracted: extractedArticles.size,
      toolCalls: result.steps?.length ?? 0,
      tokensUsed: result.usage?.totalTokens ?? 0,
    },
  };
}
```

### 修改 3（中）：复用现有基础设施

**问题**：重复实现了 `fetchStatic`、`fetchDynamic`、HTML 清洗、`extractMainContent`。

**修改**：

```typescript
// fetch_page tool 直接复用现有 fetcher
import { fetchHtml } from "../crawler/fetcher";

export const fetchPageTool = tool({
  // ...
  execute: async ({ url, render }, { toolbox }) => {
    const cached = toolbox.sessionCache.get(url);
    if (cached) return cached;

    // 直接复用现有 fetchHtml（含重试、SSL回退、编码检测）
    const html = await fetchHtml(
      url,
      render === "dynamic" ? "dynamic" : "static",
      { timeoutMs: 15000 },
      toolbox.abortSignal,
    );

    // 复用现有 Cheerio 清洗逻辑，而不是另写一套
    const cleaned = cleanAndTruncateHtml(html); // 从 parser.ts 抽取公共函数

    const result = {
      url,
      title: extractTitle(cleaned), // 复用 parser.ts 的 title 提取
      actualRender: render === "dynamic" ? "dynamic" : "static",
      statusCode: 200,
      truncated: cleaned.length > MAX_BYTES,
      byteLength: cleaned.length,
      body: cleaned.slice(0, MAX_BYTES),
    };

    toolbox.sessionCache.set(url, result);
    return result;
  },
});
```

同时从 `parser.ts` 抽取公共函数：
- `cleanHtml(html)` — HTML 清洗
- `extractTitle(html)` — 标题提取
- `extractMainContent(html)` — 通用正文提取
- `detectListPattern(html)` — 列表模式检测

让 `extract_article` tool 和现有的 `parseDetail` 共享同一套逻辑。

### 修改 4（中）：增加上下文窗口管理

**问题**：15 篇详情 HTML 累积可能超过模型 context 限制。

**修改方案 A（推荐）— 摘要模式**：

不要让 LLM 在 context 中积累 15 篇完整的详情 HTML。改为：

1. `fetch_page` 仍然返回完整 HTML
2. `analyze_page_structure` 分析列表页结构
3. `extract_items_with_strategy` 提取链接列表
4. **对每篇文章**：LLM 调用 `extract_article_content` tool，但 tool 执行提取后**只返回摘要**（标题 + 前 500 字符），不让完整 HTML 留在 context 中
5. LLM 最后一步输出文章摘要列表

```
LLM context 中的内容：
  Step 1: fetch_page 结果（列表页 HTML，~20K tokens）
  Step 2: analyze_page_structure 结果（选择器策略，~1K tokens）
  Step 3: extract_items_with_strategy 结果（链接列表，~2K tokens）
  Steps 4-18: 每篇文章 extract_article_content → 返回摘要（每篇 ~0.5K）→ 共 ~7.5K
  Step 19: 最终输出汇总

总计：~30K tokens（远低于不加管理的 400K+）
```

**修改方案 B（备选）— 分批模式**：

如果单次采集的文章过多，分两批：
1. 第一轮：提取链接列表
2. 第二轮（新的 generateText 调用）：传入链接列表，逐篇抓取详情

### 修改 5（中）：增加并行处理能力

**问题**：LLM tool-calling 是顺序的，无法并行抓取详情页。

**修改**：在获取链接列表后，切换到并行模式：

```typescript
export async function intelligentCrawl(input) {
  // Phase 1: LLM 分析列表页，获取链接列表
  const listResult = await generateText({
    model: getModel(),
    maxSteps: 3, // 只要 3 步：fetch 列表页 → 分析 → 提取链接
    tools: { fetch_page, analyze_page_structure, extract_items_with_strategy },
  });

  const articleUrls = listResult.output.articles; // LLM 输出的文章链接列表

  // Phase 2: 确定性并行抓取详情（复用现有 pipeline 的并行逻辑）
  const articles = await parallelExtractArticles(articleUrls, input.render);

  return { articles, ... };
}

async function parallelExtractArticles(
  urls: Array<{ url: string; title: string }>,
  render: "static" | "dynamic",
): Promise<ArticleData[]> {
  const tasks = urls.slice(0, 30).map((item) =>
    queueFor(item.url).add(async () => {
      const html = await fetchHtml(item.url, render, { timeoutMs: 15000 });
      const detail = parseDetail(html, {
        listSelector: null, linkSelector: null,
        titleSelector: null, bodySelector: null, dateSelector: null,
      });
      return { url: item.url, ...detail };
    }),
  );

  const results = await Promise.allSettled(tasks);
  return results
    .filter((r) => r.status === "fulfilled")
    .map((r) => (r as PromiseFulfilledResult<ArticleData>).value)
    .filter((a) => a.title && a.body.length >= 50);
}
```

这样 Phase 1 用 LLM 做"智能发现"（真正的 tool-calling 价值所在），Phase 2 复用现有的高性能并行抓取。

### 修改 6（中）：增加安全防护

**问题**：可见文本中的 prompt injection 未处理。

**修改**：

```typescript
function sanitizeForLLM(text: string): string {
  const INJECTION_PATTERNS = [
    /ignore\s+(all\s+)?(previous|above|prior)\s+(instructions?|directives?)/gi,
    /you\s+are\s+(now|no\s+longer)\s+a[n]?\s+/gi,
    /disregard\s+(all\s+)?(previous|above)\s+/gi,
    /system\s*(prompt|message|instruction)/gi,
    /<\|im_start\|>/gi,
    /<\|im_end\|>/gi,
  ];

  let sanitized = text;
  for (const pattern of INJECTION_PATTERNS) {
    sanitized = sanitized.replace(pattern, "[FILTERED]");
  }
  return sanitized;
}

// 在 fetch_page 的 execute 中：
const title = sanitizeForLLM(extractMetaTitle(html));
const body = sanitizeForLLM(cleaned);
```

### 修改 7（低）：补充缺失的集成点

**问题**：缺少 rate-limiting、abort signal 集成。

**修改**：

```typescript
// fetch_page tool 中使用 rate limiter
import { queueFor } from "../crawler/rate-limit";

execute: async ({ url, render }, { toolbox }) => {
  // 使用域名限流
  const html = await queueFor(url).add(() =>
    fetchHtml(url, mode, { timeoutMs: 15000 }, toolbox.abortSignal),
  );
  // ...
}

// intelligentCrawl 中传递 abort signal
const abortSignal = getAbortSignal();

const result = await generateText({
  // ...
  tools: {
    fetch_page: {
      execute: async (args) => {
        if (abortSignal?.aborted) throw new DOMException("用户中止", "AbortError");
        return fetchPageTool.execute!(args, {
          toolbox: { abortSignal, sessionCache, logger: console },
        });
      },
    },
    // ...
  },
  abortSignal, // AI SDK 支持传入 abortSignal
});
```

### 修改 8（低）：补充测试方案

**问题**：验收标准缺少边界测试。

**补充测试清单**：

| 测试场景 | 预期行为 |
|---|---|
| 纯静态 HTML 列表页 | 正确提取链接 |
| JS 渲染的 SPA 列表页 | Playwright 渲染后正确提取 |
| 单页应用（列表即详情） | LLM 识别并直接提取内容 |
| 空页面（无链接） | 返回空列表，不崩溃 |
| 纯图片页面 | 返回空列表，标记 `extractionMethod: "tool-calling"` + 0 articles |
| 验证码/登录页 | 检测到异常后停止，返回 partial 结果 |
| 超大页面（>500KB） | 截断并标记 `truncated: true` |
| GBK 编码页面 | 正确解码（复用现有 fetcher） |
| 跨协议重定向页面 | 正确跟随（复用现有 fetcher） |
| 含 prompt injection 文本的页面 | LLM 不受注入影响 |

---

## 第四部分：修改后的架构总览

```
┌─────────────────────────────────────────────────────────────┐
│                    intelligentCrawl()                        │
│                                                              │
│  Phase 1: LLM 驱动的列表发现 (tool-calling, maxSteps=3)      │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ LLM 调用 fetch_page(siteUrl)                          │   │
│  │   → 返回清洗后的列表页 HTML                            │   │
│  │ LLM 调用 analyze_page_structure(html)                 │   │
│  │   → LLM 真正分析 HTML，输出选择器策略                  │   │
│  │ LLM 调用 extract_items_with_strategy(html, strategy)  │   │
│  │   → 确定性 Cheerio 按 LLM 指定的选择器提取链接         │   │
│  │ LLM 输出结构化结果: { articles: [...urls] }           │   │
│  └──────────────────────────────────────────────────────┘   │
│                          ↓                                   │
│  Phase 2: 并行详情抓取 (确定性, Promise.allSettled)          │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ queueFor(url).add(fetchHtml)  × N  (域名限流)         │   │
│  │ parseDetail(html)             × N  (复用现有解析器)    │   │
│  │ → articles[]                                           │   │
│  └──────────────────────────────────────────────────────┘   │
│                          ↓                                   │
│  去重 → contentHash → 写入 DB (完全复用现有逻辑)             │
└─────────────────────────────────────────────────────────────┘
```

**关键变化**：

1. Phase 1 只用 LLM 做 3 步（不是 10 步）：抓取 → 分析 → 提取链接
2. LLM 的输出是**选择器策略**而非最终文章内容——真正的 "智能" 在于分析页面结构
3. Phase 2 用确定性并行代码抓取详情，性能与现有方案持平
4. `parseDetail` 复用现有逻辑，不重复造轮子
5. 每个 Phase 可以独立超时和降级

---

## 第五部分：实施优先级

| 序号 | 修改项 | 优先级 | 预估工时 | 依赖 |
|---|---|---|---|---|
| 1 | 重新定义 Tool 职责（analyze + execute 分离） | P0 | 6h | — |
| 2 | 补全结果提取逻辑（结构化输出） | P0 | 2h | #1 |
| 3 | 上下文窗口管理（摘要模式） | P0 | 2h | #1 |
| 4 | 增加并行处理（Phase 1 + Phase 2 分离） | P1 | 3h | #1 |
| 5 | 复用现有基础设施（fetcher/parser） | P1 | 2h | — |
| 6 | 安全防护（prompt injection sanitize） | P1 | 1h | — |
| 7 | 补充集成点（rate-limit/abort） | P2 | 1h | #5 |
| 8 | 补充测试方案 | P2 | 4h | #1-#7 |

**总计**: 约 21h（比原方案 16h 增加 5h，但解决了根本性设计问题）

---

## 总结

S18 方案的方向正确——用 LLM 解决选择器脆弱和扩展成本高的问题。但当前实现存在**两个根本性缺陷**：

1. **Tool 设计是"伪 tool-calling"**：`extract_list_items` 和 `extract_article` 本质是固定规则，LLM 只是路由器而非真正的分析者
2. **结果提取悬空**：`intelligentCrawl()` 返回 `articles: []` 带 TODO，这是整个方案的致命漏洞

核心改造思路是：**让 LLM 做它擅长的事（分析页面结构、发现选择器模式），让确定性代码做它擅长的事（并行抓取、精确提取）**。将单步 10-step tool-calling 拆分为两阶段——3 步 LLM 分析 + N 路并行确定性抓取——既保留了智能发现的优势，又避免了性能倒退和 context 溢出。
