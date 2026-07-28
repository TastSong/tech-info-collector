/**
 * 每日 AI 摘要 Digest（H）：取当天 Top N published，LLM 生成 5 条要闻摘要。
 *
 * 在 cron 分析完成后调用 generateDailyDigest()，一天只生成一次（按 date 去重）。
 */
import { getModel } from "./sandbox";
import { generateText } from "ai";
import { db, schema } from "../../db/client";
import { eq, sql } from "drizzle-orm";
import { shanghaiMidnightSecs } from "../lib/date";

const MAX_ARTICLES = 30; // 喂给 LLM 的文章数上限
const MAX_BODY_CHARS = 250; // 每篇文章正文截断

/** 计算今天 Shanghai 日期字符串 YYYY-MM-DD */
function todayDateStr(): string {
  const fmt = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date()).replace(/\//g, "-");
}

/**
 * 生成今天的 AI 摘要。已存在则跳过（一天一次）。
 * 返回生成的 digest 或 null（已有/无文章/失败）。
 */
export async function generateDailyDigest(): Promise<{
  date: string;
  content: string;
  articleCount: number;
} | null> {
  const d = todayDateStr();

  // 今天已有摘要 → 跳过
  const existing = db
    .select()
    .from(schema.dailyDigests)
    .where(eq(schema.dailyDigests.date, d))
    .limit(1)
    .all()
    .at(0);
  if (existing) {
    console.log(`[digest] ${d} 已有摘要，跳过`);
    return null;
  }

  // 取今日 Top N published（去重 by content_hash，按 quality_score 降序）
  const todaySecs = shanghaiMidnightSecs(0);
  const rows = db.all(sql`
    SELECT a.id, a.title, a.body, s.name AS site_name, r.headline, r.summary,
           r.quality_score, r.tags
    FROM articles a
    JOIN sites s ON a.site_id = s.id
    JOIN ai_reviews r ON r.article_id = a.id
    WHERE a.status = 'published'
      AND COALESCE(a.published_at, a.fetched_at) >= ${todaySecs}
    GROUP BY COALESCE(a.content_hash, '#' || a.id)
    ORDER BY r.quality_score DESC
    LIMIT ${MAX_ARTICLES}
  `) as {
    id: number;
    title: string | null;
    body: string | null;
    site_name: string;
    headline: string | null;
    summary: string | null;
    quality_score: number | null;
    tags: string | null;
  }[];

  if (rows.length === 0) {
    console.log(`[digest] ${d} 今日无 published 文章，跳过`);
    return null;
  }

  // 构造 prompt：每篇文章一行标题+摘要
  const articlesBlock = rows
    .map(
      (r, i) =>
        `${i + 1}. [${r.site_name}] ${r.headline || r.title || "(无标题)"}\n` +
        `   摘要：${(r.summary ?? "").slice(0, 120)}\n` +
        `   标签：${r.tags ?? ""}`,
    )
    .join("\n");

  const prompt = `
以下是今日（${d}）科技情报采集器收录的 ${rows.length} 篇文章摘要。

${articlesBlock}

请根据以上内容，用中文生成一份**今日科技要闻**，要求：
1. 提炼 5 条最重要的要闻（如果文章不足 5 条则相应减少）
2. 每条要闻用「**标题**：要点（来源）格式」格式，包含实质性信息
3. 开头加一行「📰 今日科技要闻（${d}）」，再空一行
4. 末尾加一行「---」并注明覆盖文章数
5. 纯 Markdown，不超过 500 字，直接输出不要解释`;

  try {
    const { text } = await generateText({
      model: getModel(),
      temperature: 0.3,
      system: "你是科技新闻编辑，擅长将含噪资讯提炼为精炼要闻。",
      prompt,
    });

    const content = text.trim();
    if (!content) return null;

    db.insert(schema.dailyDigests)
      .values({ date: d, content, articleCount: rows.length })
      .run();

    console.log(`[digest] ${d} 生成完成，覆盖 ${rows.length} 篇文章，${content.length} 字`);
    return { date: d, content, articleCount: rows.length };
  } catch (e) {
    console.error(`[digest] 生成失败: ${(e as Error).message}`);
    return null;
  }
}

/** 获取指定日期的摘要（如果是今天的则自动触发懒生成） */
export function getDigestForDate(date: string) {
  return db
    .select()
    .from(schema.dailyDigests)
    .where(eq(schema.dailyDigests.date, date))
    .limit(1)
    .all()
    .at(0) ?? null;
}

/** 获取最新一条摘要（不区分日期） */
export function getLatestDigest() {
  return db
    .select()
    .from(schema.dailyDigests)
    .orderBy(sql`${schema.dailyDigests.date} DESC`)
    .limit(1)
    .all()
    .at(0) ?? null;
}
