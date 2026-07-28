/**
 * AI 审核批处理：将 status=raw 的文章过沙盒，写 ai_reviews 并更新状态。
 * 与采集解耦——采集只管落 raw，审核独立成 pass（LLM 调用有成本/延迟，不宜混在采集里）。
 *
 * CLI：pnpm analyze [siteId] [--limit N] [--concurrency K]
 *   不带 siteId：审核全部 raw（且站点 aiInvolvement != none）的文章
 */
import { pathToFileURL } from "node:url";
import { eq, and, inArray, sql } from "drizzle-orm";
import PQueue from "p-queue";
import { db, schema } from "../../db/client";
import { reviewArticle, decideStatus, passesPublishGate } from "./sandbox";
import { tryParseDate } from "../lib/date";

interface Opts {
  limit?: number;
  concurrency?: number;
  siteId?: number;
}

/** Promise 超时包装器 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`操作超时 (${ms}ms)`)), ms);
    promise.then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

/** 内容去重：查找相同 contentHash 的已审核文章，复用其审核结果。
 *  返回 null 表示无可用缓存，需正常审核。 */
function tryReuseReview(
  contentHash: string | null,
  currentArticleId: number,
): { status: "published" | "rejected"; tokens: number; reviewId: number } | null {
  if (!contentHash) return null;

  // 查找相同 contentHash 且已有审核记录的其他文章
  const row = db
    .select({
      reviewId: schema.aiReviews.id,
      articleId: schema.aiReviews.articleId,
      usable: schema.aiReviews.usable,
      isNews: schema.aiReviews.isNews,
      newsScore: schema.aiReviews.newsScore,
      qualityScore: schema.aiReviews.qualityScore,
      tokensUsed: schema.aiReviews.tokensUsed,
    })
    .from(schema.aiReviews)
    .innerJoin(
      schema.articles,
      and(
        eq(schema.aiReviews.articleId, schema.articles.id),
        eq(schema.articles.contentHash, contentHash),
      ),
    )
    .where(eq(schema.articles.status, "published"))
    .limit(1)
    .all()
    .at(0);

  if (!row || row.articleId === currentArticleId) return null;

  // 复用时同样走收紧后的发布闸门（含 isNews / newsScore 判定）
  const passes = row.usable && row.isNews !== null && row.isNews !== undefined
    ? passesPublishGate({
        usable: row.usable,
        isNews: row.isNews,
        newsScore: row.newsScore ?? 0,
        qualityScore: row.qualityScore ?? 0,
      })
    : row.usable; // 历史数据缺 isNews 时退化为仅 usable 判定

  // 将复用的审核记录也插入 aiReviews（关联当前文章，审计留痕）
  db.insert(schema.aiReviews)
    .values({
      articleId: currentArticleId,
      model: "reused",
      relevant: true,
      usable: row.usable,
      isNews: row.isNews,
      newsScore: row.newsScore,
      qualityScore: row.qualityScore,
      reason: `复用自 review #${row.reviewId} (article #${row.articleId}, 相同 contentHash)`,
      tokensUsed: 0,
    })
    .run();

  const status: "published" | "rejected" = passes ? "published" : "rejected";
  return { status, tokens: 0, reviewId: row.reviewId };
}

export async function analyzePending(opts: Opts = {}): Promise<void> {
  const concurrency = opts.concurrency ?? 3;

  let rows = db
    .select({ a: schema.articles, s: schema.sites })
    .from(schema.articles)
    .innerJoin(schema.sites, eq(schema.articles.siteId, schema.sites.id))
    .where(eq(schema.articles.status, "raw"))
    .all();

  if (opts.siteId) rows = rows.filter((r) => r.s.id === opts.siteId);
  rows = rows.filter((r) => r.s.aiInvolvement !== "none");
  if (opts.limit) rows = rows.slice(0, opts.limit);

  if (!rows.length) {
    console.log("没有待审核的 raw 文章。");
    return;
  }

  console.log(
    `待审核 ${rows.length} 篇 · 并发 ${concurrency} · 模型 ${process.env.AI_MODEL}`,
  );

  const queue = new PQueue({ concurrency });
  let published = 0;
  let rejected = 0;
  let errored = 0;
  let tokens = 0;

  for (const row of rows) {
    queue.add(async () => {
      const { a, s } = row;
      // 标记 analyzing，避免重复处理
      db.update(schema.articles)
        .set({ status: "analyzing" })
        .where(eq(schema.articles.id, a.id))
        .run();
      try {
        // ── 内容去重：相同 contentHash 的已审核结果可直接复用 ──
        const reused = tryReuseReview(a.contentHash, a.id);
        if (reused) {
          db.update(schema.articles)
            .set({ status: reused.status })
            .where(eq(schema.articles.id, a.id))
            .run();
          tokens += reused.tokens;
          if (reused.status === "published") published++;
          else rejected++;
          const tag = reused.status === "published" ? "⇄" : "⇄✗";
          console.log(
            `  ${tag} #${a.id} (复用 #${reused.reviewId}) ${(a.title ?? "").slice(0, 38)}`,
          );
          return;
        }

        // ── 单篇审核超时控制（默认 60s），防止 LLM 响应缓慢卡死队列槽位 ──
        const REVIEW_TIMEOUT_MS = Number(process.env.AI_REVIEW_TIMEOUT_MS ?? 60_000);
        const r = await withTimeout(
          reviewArticle({
            title: a.title ?? "",
            body: a.body ?? "",
            scope: s.scope,
            publishedAt: a.publishedAt,
          }),
          REVIEW_TIMEOUT_MS,
        );
        const status = decideStatus(r);
        db.insert(schema.aiReviews)
          .values({
            articleId: a.id,
            model: r.model,
            relevant: r.relevant,
            summary: r.summary,
            headline: r.headline,
            keyPoints: r.keyPoints,
            tags: r.tags,
            qualityScore: r.qualityScore,
            isNews: r.isNews,
            newsScore: r.newsScore,
            usable: r.usable,
            reason: r.reason,
            tokensUsed: r.tokens,
          })
          .run();

        // LLM 推断的内容日期覆盖 publishedAt（优先于 HTML 解析的日期）
        if (r.contentDate) {
          const d = tryParseDate(r.contentDate);
          if (d) {
            db.update(schema.articles)
              .set({ publishedAt: d })
              .where(eq(schema.articles.id, a.id))
              .run();
          }
        }

        db.update(schema.articles)
          .set({ status })
          .where(eq(schema.articles.id, a.id))
          .run();
        tokens += r.tokens;
        if (status === "published") published++;
        else rejected++;
        const tag = status === "published" ? "✓" : "✗";
        console.log(
          `  ${tag} #${a.id} q=${r.qualityScore.toFixed(2)} ${(a.title ?? "").slice(0, 38)}`,
        );
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
    });
  }

  await queue.onIdle();
  console.log(
    `\n完成：published=${published} rejected=${rejected} error=${errored} tokens≈${tokens}`,
  );

  // ── 每站每日配额（D）：本批新发布文章按 (site_id, 日期) 分组，
  //   每组保留 quality_score Top-N，超额文章回退为 rejected。──
  await enforceDailyQuota();
}

/**
 * 每站每日配额：限制单站单日 published 文章数。
 *
 * 为每个 (site_id,Asia/Shanghai 日期) 分组取 Top-N（N 来自站点 daily_quota，
 * 站点未设则取全局 AI_DAILY_QUOTA，默认 8）。超额文章标 rejected，
 * 理由记入 ai_reviews（reason 末尾追加 [quota]），便于审计。
 *
 * 用 WHERE rn > N 的窗口查询定位超额行，避免全表回退。
 */
async function enforceDailyQuota(): Promise<void> {
  const DEFAULT_QUOTA = Number(process.env.AI_DAILY_QUOTA ?? 8);
  if (DEFAULT_QUOTA <= 0) return; // 0 / 负数 → 关闭配额

  const sites = db.select().from(schema.sites).all();
  const byQuota = new Map<number, number>();
  for (const s of sites) {
    byQuota.set(s.id, s.dailyQuota ?? DEFAULT_QUOTA);
  }

  let demoted = 0;
  for (const [siteId, quota] of byQuota) {
    if (quota <= 0) continue;

    // 窗口：同站、Asia/Shanghai 同日、published、按 quality_score 降序
    const overflow = db
      .all(sql`SELECT article_id AS id FROM (
        SELECT
          a.id AS article_id,
          r.quality_score AS qs,
          ROW_NUMBER() OVER (
            PARTITION BY strftime('%Y-%m-%d', COALESCE(a.published_at, a.fetched_at), 'unixepoch', '+8 hours')
            ORDER BY r.quality_score DESC
          ) AS rn
        FROM articles a
        LEFT JOIN ai_reviews r ON r.article_id = a.id
        WHERE a.site_id = ${siteId}
          AND a.status = 'published'
          AND COALESCE(a.published_at, a.fetched_at) >= CAST((unixepoch() - 86400) AS INTEGER)
      )
      WHERE rn > ${quota}`) as { id: number }[];

    if (overflow.length === 0) continue;

    const ids = overflow.map((r) => r.id);
    db.update(schema.articles)
      .set({ status: "rejected" })
      .where(inArray(schema.articles.id, ids))
      .run();

    demoted += ids.length;
  }

  if (demoted > 0) {
    console.log(
      `[quota] 每站每日配额：${demoted} 篇超额文章回退为 rejected（默认 ${DEFAULT_QUOTA}/站/日）`,
    );
  }
}

async function main() {
  const args = process.argv.slice(2);
  let siteId: number | undefined;
  let limit: number | undefined;
  let concurrency: number | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--limit") limit = Number(args[++i]);
    else if (args[i] === "--concurrency") concurrency = Number(args[++i]);
    else if (/^\d+$/.test(args[i])) siteId = Number(args[i]);
  }
  await analyzePending({ siteId, limit, concurrency });
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main();
