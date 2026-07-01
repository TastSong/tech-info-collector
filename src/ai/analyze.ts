/**
 * AI 审核批处理：将 status=raw 的文章过沙盒，写 ai_reviews 并更新状态。
 * 与采集解耦——采集只管落 raw，审核独立成 pass（LLM 调用有成本/延迟，不宜混在采集里）。
 *
 * CLI：pnpm analyze [siteId] [--limit N] [--concurrency K]
 *   不带 siteId：审核全部 raw（且站点 aiInvolvement != none）的文章
 */
import { pathToFileURL } from "node:url";
import { eq } from "drizzle-orm";
import PQueue from "p-queue";
import { db, schema } from "../../db/client";
import { reviewArticle, decideStatus } from "./sandbox";

interface Opts {
  limit?: number;
  concurrency?: number;
  siteId?: number;
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
  let ready = 0;
  let rejected = 0;
  let review = 0;
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
        const r = await reviewArticle({
          title: a.title ?? "",
          body: a.body ?? "",
          scope: s.scope,
        });
        const status = decideStatus(r);
        db.insert(schema.aiReviews)
          .values({
            articleId: a.id,
            model: r.model,
            relevant: r.relevant,
            summary: r.summary,
            keyPoints: r.keyPoints,
            tags: r.tags,
            qualityScore: r.qualityScore,
            usable: r.usable,
            reason: r.reason,
            tokensUsed: r.tokens,
          })
          .run();
        db.update(schema.articles)
          .set({ status })
          .where(eq(schema.articles.id, a.id))
          .run();
        tokens += r.tokens;
        if (status === "ready") ready++;
        else if (status === "rejected") rejected++;
        else review++;
        const tag = status === "ready" ? "✓" : status === "rejected" ? "✗" : "?";
        console.log(
          `  ${tag} #${a.id} q=${r.qualityScore.toFixed(2)} ${(a.title ?? "").slice(0, 38)}`,
        );
      } catch (e) {
        errored++;
        // 失败转人工复核，不阻断批次
        db.update(schema.articles)
          .set({ status: "review" })
          .where(eq(schema.articles.id, a.id))
          .run();
        console.log(
          `  ! #${a.id} 失败→review: ${(e as Error).message.slice(0, 90)}`,
        );
      }
    });
  }

  await queue.onIdle();
  console.log(
    `\n完成：ready=${ready} rejected=${rejected} review=${review} error=${errored} tokens≈${tokens}`,
  );
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
