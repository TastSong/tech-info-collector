/**
 * AI 沙盒（v1：最简形态）。
 *
 * 边界由确定性代码强制：
 *  - 输入硬截断（标题 200、正文 6000 字）—— LLM 看不到全库、看不到网络
 *  - 输出强制 Zod schema（generateObject）—— 无自由文本逃逸，校验失败即报错
 *  - 无工具集（v1）—— LLM 无法调用任何工具；v2 再加白名单只读工具
 *  - 低温度（0.2）—— 降低随机性
 *  - 最终状态由 decideStatus 代码决定，LLM 的 usable/score 仅是建议
 *
 * 环境变量（.env）：AI_BASE_URL / AI_API_KEY / AI_MODEL / AI_REVIEW_LOW / AI_REVIEW_HIGH
 */
import "dotenv/config";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText, type LanguageModel } from "ai";
import { reviewSchema, type Review } from "./schemas";

const MAX_INPUT_CHARS = 6000;

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`缺少环境变量 ${name}（请检查 .env）`);
  return v;
}

let _model: LanguageModel | null = null;

/** 单例模型（确定性：provider 配置由 env 控制 = 我们的"权限/范围"）。 */
export function getModel(): LanguageModel {
  if (_model) return _model;
  const provider = createOpenAICompatible({
    name: "tic-llm",
    baseURL: req("AI_BASE_URL"),
    apiKey: req("AI_API_KEY"),
  });
  _model = provider.chatModel(req("AI_MODEL"));
  return _model;
}

export interface ReviewResult extends Review {
  model: string;
  tokens: number;
}

/** 对单篇文章做结构化审核（沙盒内）。
 *  采用"提示词 JSON 模式 + Zod 校验"：兼容网关多不支持 response_format /
 *  tool 结构化输出，故让模型只回 JSON 文本，由确定性代码解析校验。
 *  沙盒边界不变：输入硬截断、输出 Zod 强校验、低温度、无工具。 */
export async function reviewArticle(input: {
  title: string;
  body: string;
  scope: string | null;
}): Promise<ReviewResult> {
  const title = (input.title ?? "").slice(0, 200);
  const body = (input.body ?? "").slice(0, MAX_INPUT_CHARS);
  const scope = input.scope ?? "科技情报(泛)";

  const { text, usage } = await generateText({
    model: getModel(),
    temperature: 0.2,
    system:
      "你是科技情报审核助手。依据给定的关注范围(scope)，对文章做结构化提取与可用性判定。" +
      "输出要求：只返回一个 JSON 对象，不要 markdown 代码块、不要解释、不要多余文字。" +
      "字段：relevant(boolean) 是否属于 scope 范围；summary(string,≤100字中文摘要)；" +
      "keyPoints(string[],3-5条)；tags(string[],2-5个)；" +
      "qualityScore(number,0-1,情报价值/可用性)；usable(boolean,是否真实可用非噪声/导航/空壳/无关转载)；" +
      "reason(string,一句话理由)。" +
      "判定规则：导航/目录页/公告空壳/与范围明显无关 → usable=false 且 qualityScore<0.3；" +
      "真实相关情报 → usable=true，按信息量/时效/影响力给 0.3-1.0。",
    prompt:
      `关注范围(scope)：${scope}\n\n` +
      `标题：${title}\n\n正文：\n${body}\n\n只输出 JSON 对象。`,
  });

  const parsed = reviewSchema.safeParse(extractJson(text));
  if (!parsed.success) {
    throw new Error(
      `LLM 输出未通过 schema 校验: ${parsed.error.issues.slice(0, 2).join("; ")}`,
    );
  }
  return {
    ...parsed.data,
    model: process.env.AI_MODEL!,
    tokens: usage?.totalTokens ?? 0,
  };
}

/** 从模型回复中提取首个 JSON 对象（容忍 ```json 代码块与前后多余文字）。 */
function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("LLM 输出未找到 JSON 对象");
  }
  return JSON.parse(raw.slice(start, end + 1));
}

const threshold = (name: string, def: number) =>
  Number(process.env[name] ?? def);

/**
 * 确定性状态闸门 —— LLM 的 usable/relevant/score 仅是建议，最终落库状态由此函数决定。
 *   !usable             → rejected（噪声/空壳）
 *   usable 但 !relevant  → review（偏离范围，人工定夺）
 *   score >= HIGH        → ready（高质量可用）
 *   score < LOW          → rejected（低质量）
 *   其余（灰区）          → review（人工复核）
 */
export function decideStatus(r: Review): "ready" | "rejected" | "review" {
  const lo = threshold("AI_REVIEW_LOW", 0.4);
  const hi = threshold("AI_REVIEW_HIGH", 0.7);
  if (!r.usable) return "rejected";
  if (!r.relevant) return "review";
  if (r.qualityScore >= hi) return "ready";
  if (r.qualityScore < lo) return "rejected";
  return "review";
}
