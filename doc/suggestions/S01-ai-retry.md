# S01: 添加 AI 审核失败重试机制

**关联分析**: [ANALYSIS.md](../ANALYSIS.md) → §8.1 短期改进

**优先级**: P0（高优先）  
**涉及文件**: `src/ai/sandbox.ts`  
**预估工时**: 2h

---

## 原因

### 当前行为

```typescript
// src/ai/sandbox.ts:63-100
const { text, usage } = await generateText({
  model: getModel(),
  temperature: 0.2,
  system: "...",
  prompt: "...",
  // ❌ 无 maxRetries，SDK 默认重试 2 次，但用户不知道
  // ❌ 无 output，返回原始文本，手动 extractJson + Zod 校验
});

const parsed = reviewSchema.safeParse(extractJson(text));
if (!parsed.success) {
  throw new Error(`LLM 输出未通过 schema 校验: ...`);
}
```

两个问题：

1. **`maxRetries` 依赖默认值（2）且未显式声明**：SDK 内部会对网络/5xx/429 重试，但 2 次可能不够，且调用方完全不知情
2. **Zod 校验在 SDK 外部**：LLM 返回了语法正确的 JSON 但字段不满足 schema 约束时，代码直接抛异常，`analyze.ts` 中 catch 后标记 `rejected`——但实际上这种"格式正确但内容不合规"的错误，再让 LLM 生成一次通常能修好

### 风险评估

- **数据损失**：LLM 服务不稳定时段或模型输出不稳定时，所有待审核文章可能被错误驳回
- **不可恢复**：`analyze.ts` 中 catch 后直接 reject，没有重新排队机制
- **静默失败**：用户可能不知道有多少文章是因审核失败而被驳回的

### 设计目标

利用 AI SDK v7 内置能力，一步到位解决：
1. `maxRetries: 3`：SDK 对 HTTP 错误 + JSON 解析错误自动重试
2. `output.object({ schema })`：Zod schema 直接传入 SDK，结构化输出 + 自动校验，不再手动 `extractJson`
3. `experimental_repairText`：对轻微 JSON 格式问题做一次修复后再决定是否重试

---

## 详细修改步骤

### 步骤 1：修改 `sandbox.ts` — 使用 SDK 原生结构化输出

```typescript
// src/ai/sandbox.ts
// 新增导入
import { generateText, output } from "ai";

export async function reviewArticle(input: {
  title: string;
  body: string;
  scope: string | null;
  publishedAt: Date | null;
}): Promise<ReviewResult> {
  const title = (input.title ?? "").slice(0, 200);
  const body = (input.body ?? "").slice(0, MAX_INPUT_CHARS);
  const scope = input.scope ?? "科技情报(泛)";
  const pubTime =
    input.publishedAt instanceof Date && !isNaN(input.publishedAt.getTime())
      ? input.publishedAt.toISOString().slice(0, 10)
      : "未知";

  const { output: result, usage } = await generateText({
    model: getModel(),
    temperature: 0.2,
    maxRetries: 3,       // SDK 内置：HTTP失败 + JSON解析失败 总计最多 3 次重试
    output: output.object({
      schema: reviewSchema, // Zod schema 直接传入，SDK 自动校验
    }),
    // 对轻微格式问题做一次修复（尾部多余逗号、缺括号等），修不了则触发重试
    experimental_repairText: async ({ text, error }) => {
      // 尝试修复常见的 JSON 格式问题
      let repaired = text.trim();
      // 去掉末尾多余逗号
      repaired = repaired.replace(/,(\s*[}\]])/g, "$1");
      // 尝试补全未闭合的括号
      const openBraces = (repaired.match(/{/g) || []).length;
      const closeBraces = (repaired.match(/}/g) || []).length;
      if (openBraces > closeBraces) {
        repaired += "}".repeat(openBraces - closeBraces);
      }
      if (repaired !== text.trim()) return repaired;
      return null; // 无法修复，SDK 会自动重试（计入 maxRetries）
    },
    system:
      "你是科技情报审核助手。依据给定的关注范围(scope)、发布时间，对文章做结构化提取与可用性判定。" +
      // ... system prompt 保持不变
      "注意：新闻判断只看内容性质，不看 relevance/usable 的结论。即便内容相关且可用，只要不是新闻形式也要标记 isNews=false。",
    prompt:
      `关注范围(scope)：${scope}\n\n` +
      `发布时间：${pubTime}\n\n` +
      `标题：${title}\n\n正文：\n${body}`,
  });

  // SDK 的 output.object({schema}) 返回类型是 Review，不再是原始文本
  return {
    ...result!,       // result 类型 = z.infer<typeof reviewSchema>
    model: process.env.AI_MODEL!,
    tokens: usage?.totalTokens ?? 0,
  };
}
```

### 步骤 2：删除旧的手动解析代码

删除 `sandbox.ts` 中不再需要的代码：

```diff
- const { text, usage } = await generateText({ ... });
-
- const parsed = reviewSchema.safeParse(extractJson(text));
- if (!parsed.success) {
-   throw new Error(
-     `LLM 输出未通过 schema 校验: ${parsed.error.issues.slice(0, 2).join("; ")}`,
-   );
- }
- return {
-   ...parsed.data,
-   model: process.env.AI_MODEL!,
-   tokens: usage?.totalTokens ?? 0,
- };
```

`extractJson` 函数也可以删除（或保留用于其他场景）。

### 步骤 3：删除 `analyze.ts` 中对 `isRetryableError` 的引用

当前 S01 原方案设计了手写 `isRetryableError`，现在不需要了。`analyze.ts` 的 catch 块保持简单：

```typescript
// src/ai/analyze.ts — catch 块保持不变
} catch (e) {
  errored++;
  // 失败直接驳回，不阻断批次
  db.update(schema.articles)
    .set({ status: "rejected" })
    .where(eq(schema.articles.id, a.id))
    .run();
  console.log(
    `  ! #${a.id} 失败→rejected: ${(e as Error).message.slice(0, 90)}`,
  );
}
```

SDK 在 `generateText` 内部已完成重试，如果仍然抛异常，说明重试 3 次均失败，此时标记 rejected 是合理的。

### 步骤 4：验证

1. 正常审核流程不受影响
2. 模拟网络错误（临时改错 `AI_BASE_URL`）→ 确认 SDK 自动重试 3 次 → 最终抛 `RetryError`
3. 模拟 JSON 格式错误（用本地 model mock 返回不完整 JSON）→ 确认 `repairText` 触发 + 重试
4. 确认 `RetryError.isInstance()` 可用于日志分类（区分网络错误 vs 真实审核结果）
5. 确认 `maxRetries: 0` 可禁用重试（调试时用）

---

## 影响范围

| 影响 | 说明 |
|---|---|
| 执行时间 | SDK 内部重试 3 次，最坏增加约 30s（取决于 LLM 响应速度） |
| 代码变化 | `sandbox.ts` 减少 ~20 行（删除手动 JSON 解析），新增 `output` + `maxRetries` 参数 |
| 向后兼容 | `ReviewResult` 返回类型不变，调用方 `analyze.ts` 无需修改 |
| 行为变化 | JSON/Zod 校验失败从"直接抛异常"变为"SDK 自动重试" |
| 新功能 | `repairText` 可修复尾部多余逗号、未闭合括号等常见格式问题 |
