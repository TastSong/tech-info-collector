/** AI 审核输出 schema —— LLM 必须按此结构返回（generateObject + Zod 强制校验）。 */
import { z } from "zod";

export const reviewSchema = z.object({
  relevant: z
    .boolean()
    .describe("内容是否属于该站点 scope 关注范围内的科技情报"),
  summary: z.string().describe("100 字以内的中文摘要"),
  headline: z
    .string()
    .describe("≤30字短标题，用于资讯流展示，提炼文章最核心的情报信息"),
  keyPoints: z.array(z.string()).describe("3-5 条简短关键信息点"),
  tags: z.array(z.string()).describe("2-5 个主题标签"),
  qualityScore: z
    .number()
    .min(0)
    .max(1)
    .describe("情报价值/可用性综合评分 0-1；噪声/空壳/纯导航给低分"),
  usable: z
    .boolean()
    .describe("内容是否可用（真实文章且非噪声/导航/公告空壳/无关转载）"),
  reason: z.string().describe("一句话判断理由"),
});

export type Review = z.infer<typeof reviewSchema>;
