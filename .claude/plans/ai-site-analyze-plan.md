# 实施计划：AI识别 站点导入功能

## 目标

在创建/导入站点时，用户只需填写 **名称** 和 **URLs**，然后点击 **"AI识别"** 按钮即可自动补充其余字段。关键能力：
- 自动检测渲染模式（优先静态，静态不工作时回退到动态）
- 自动发现 CSS 选择器
- 自动分类/子分类/关注范围

---

## 文件变更

| 文件 | 操作 | 说明 |
|------|--------|---------|
| `src/ai/site-analyzer.ts` | **新增** | 核心分析逻辑 |
| `app/api/sites/analyze/route.ts` | **新增** | API 端点 |
| `app/sites/edit-form.tsx` | **修改** | 添加 AI识别 按钮和结果展示 |

---

## 步骤 1：新增 `src/ai/site-analyzer.ts`

核心分析模块，与服务端 API 分离（便于测试和潜在的 CLI 使用）。

### 1a. 渲染模式检测（`detectRenderMode`）

对每个 URL（最多 3 个）：
1. 先尝试 **静态** 抓取 (`fetchHtml(url, "static")`)
2. 判断 HTML 是否"有意义"：
   - `body` 文本长度 > 200 字符
   - 至少有 3 个 `<a>` 标签
   - 不包含 "enable JavaScript" / "noscript" 等空壳特征
3. 静态失败则尝试**动态**抓取 (Playwright)
4. 记录每种模式的结果，优先选择静态（全部/大多数成功即选静态）

### 1b. HTML 预处理

- 复用 `src/crawler/intelligent.ts` 的 `cleanPageHtml()` / `sanitizeForLLM()`
- 截断至 ~50KB
- 生成"结构摘要"：类似 `probe.ts` 的逻辑，统计候选选择器模式及其出现次数

### 1c. LLM 分析

使用与 `intelligent-crawl.ts` 相同的模式（`generateText` + `getModel()` + `temperature: 0.1`），发送结构摘要 + 清理后的 HTML 给 LLM，要求返回包含以下内容的 JSON：
- `listSelector`, `itemSelector`, `linkSelector`, `titleSelector`, `bodySelector`, `dateSelector`
- `category`, `subcategory`, `scope`

### 1d. 选择器验证（3 层策略）

- **第 1 层**：对 HTML 运行 `parseList()` 验证选择器。如果返回 ≥ 3 个条目 → 标记置信度 "高"
- **第 2 层**：0 个条目 → 回退到确定性方法（inspect.ts 的 looksLikeArticle 统计），标记置信度 "中"
- **第 3 层**：确定性方法也返回 0 → 使用合理默认值，标记置信度 "低"

### 1e. 函数签名

```typescript
export async function analyzeSite(input: {
  name: string;
  urls: string[];
  signal?: AbortSignal;
}): Promise<AnalyzeResult>
```

返回：`category`, `subcategory`, `render`, `listSelector`, `itemSelector`, `linkSelector`, `titleSelector`, `bodySelector`, `dateSelector`, `aiInvolvement`, `scope`, `sampleLinks[]`, `diagnostics`

---

## 步骤 2：新增 `app/api/sites/analyze/route.ts`

遵循现有 API 模式（`NextResponse`、`force-dynamic`、自动由中间件认证）：
- **输入**：`{ name: string, urls: string[] }`
- **验证**：name 必填、URLs 数组至少含一个有效 URL
- **处理**：调用 `analyzeSite()`，超时 45s
- **输出**：完整 `AnalyzeResult` JSON

错误处理：400（输入验证失败）、500（分析异常）、504（超时）

---

## 步骤 3：修改 `app/sites/edit-form.tsx`

### 3a. 新增状态
- `analyzing`：加载状态
- `aiResult`：AI 返回结果（用于展示摘要）

### 3b. 新增 "🤖 AI识别" 按钮

位置：基本信息区域顶部（名称字段附近）

禁用条件：名称未填写或没有有效 URL

加载状态：显示旋转图标 + "分析中…（约需 10-30 秒）"

### 3c. `handleAiAnalyze` 合并策略

**仅覆盖空字段**：如果用户已手动填写了某个字段，不覆盖它。如果字段为空，则填入 AI 建议值。这是一个体面的用户体验，既不会丢弃用户编辑的内容，又能填充未知字段。

### 3d. 结果摘要横幅

分析完成后展示可折叠的信息卡片：
- 检测到的渲染模式（静态/动态）
- 分类
- 各 CSS 选择器
- 置信度（高/中/低）
- Token 消耗
- 示例文章链接（可折叠面板）

---

## 实现顺序

1. **先** 实现 `src/ai/site-analyzer.ts`（纯逻辑，无 UI 依赖）
2. **再** 实现 `app/api/sites/analyze/route.ts`（薄封装）
3. **最后** 修改 `app/sites/edit-form.tsx`（UI 集成）

---

## 不涉及的内容

- 无需修改 `db/schema.ts`
- 无需修改 `package.json`
- 无需修改中间件（认证自动覆盖 `/api/sites/*`）
- 所有依赖（`getModel`、`fetchHtml`、`cleanPageHtml`、`sanitizeForLLM`、`parseList`、`generateText`、`cheerio`、`zod`）均已存在于代码库中
