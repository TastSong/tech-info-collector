/**
 * 采集运行编排：
 *   所有站点统一走智能爬虫 (LLM tool-calling 自适应提取)
 *   → 去重 → contentHash 对比 → 写入 DB (status=raw)
 *   → run_logs 记录；按域名限流。
 */
import { eq } from "drizzle-orm";
import { db, schema } from "../../db/client";
import type { Site } from "./types";
import { getAbortSignal } from "./abort";
import { intelligentCrawl } from "../ai/intelligent-crawl";

export interface RunResult {
  fetched: number;
  skipped: number;
  updated: number;
  errorCount: number;
  status: "success" | "partial" | "error";
}

type ExistingEntry = { id: number; siteId: number; hash: string };

interface ReadyArticle {
  url: string;
  title: string;
  body: string;
  contentHash: string;
  publishedAt: Date | null;
}

interface DedupResult {
  fetched: number;
  skipped: number;
  updated: number;
  errorCount: number;
  duplicateCount: number;
  errors: string[];
}

function deduplicateAndSave(
  articles: ReadyArticle[],
  siteId: number,
  existing: Map<string, ExistingEntry>,
  errors: string[],
): DedupResult {
  let fetched = 0, skipped = 0, updated = 0, errorCount = 0, duplicateCount = 0;

  for (const article of articles) {
    const prev = existing.get(article.url);

    if (prev) {
      if (prev.siteId !== siteId) { duplicateCount++; continue; }
      if (prev.hash === article.contentHash) { skipped++; continue; }
      try {
        db.update(schema.articles)
          .set({
            title: article.title,
            body: article.body,
            contentHash: article.contentHash,
            publishedAt: article.publishedAt,
            status: "raw",
            fetchedAt: new Date(),
          })
          .where(eq(schema.articles.id, prev.id))
          .run();
        updated++;
      } catch (e) {
        errorCount++;
        errors.push(`update: ${(e as Error).message}`);
      }
    } else {
      try {
        db.insert(schema.articles)
          .values({
            siteId,
            url: article.url,
            title: article.title,
            body: article.body,
            publishedAt: article.publishedAt,
            contentHash: article.contentHash,
            status: "raw",
          })
          .run();
        existing.set(article.url, { id: -1, siteId, hash: article.contentHash });
        fetched++;
      } catch (e) {
        const msg = (e as Error).message;
        if (msg.includes("UNIQUE constraint")) duplicateCount++;
        else { errorCount++; errors.push(`insert: ${msg}`); }
      }
    }
  }

  return { fetched, skipped, updated, errorCount, duplicateCount, errors };
}

function finalizeRun(logId: number, siteId: number, dedup: DedupResult): RunResult {
  const status: RunResult["status"] =
    dedup.errorCount > 0 && (dedup.fetched > 0 || dedup.updated > 0) ? "partial"
    : dedup.errorCount > 0 ? "error"
    : dedup.duplicateCount > 0 ? "partial"
    : "success";

  const summaryParts: string[] = [];
  if (dedup.duplicateCount > 0) summaryParts.push(`dup:${dedup.duplicateCount}`);
  const message = dedup.errors.slice(0, 5).join(" | ") || null;
  const fullMessage = summaryParts.length > 0
    ? (message ? `${summaryParts.join(" ")} | ${message}` : summaryParts.join(" "))
    : message;

  db.update(schema.runLogs)
    .set({ endedAt: new Date(), status, fetched: dedup.fetched, skipped: dedup.skipped, updated: dedup.updated, errorCount: dedup.errorCount, message: fullMessage })
    .where(eq(schema.runLogs.id, logId))
    .run();
  db.update(schema.sites).set({ lastRunAt: new Date() }).where(eq(schema.sites.id, siteId)).run();

  return { fetched: dedup.fetched, skipped: dedup.skipped, updated: dedup.updated, errorCount: dedup.errorCount, status };
}

export async function runSite(site: Site, crawlSessionId?: number): Promise<RunResult> {
  const logId = (
    db.insert(schema.runLogs).values({ siteId: site.id, crawlSessionId: crawlSessionId ?? null, startedAt: new Date(), status: "running" }).run().lastInsertRowid as number
  ) ?? 0;

  const errors: string[] = [];

  const existing = new Map<string, ExistingEntry>(
    db.select({ url: schema.articles.url, id: schema.articles.id, siteId: schema.articles.siteId, hash: schema.articles.contentHash })
      .from(schema.articles).all()
      .map((r) => [r.url, { id: r.id, siteId: r.siteId, hash: r.hash ?? "" }]),
  );

  try {
    // aiInvolvement === 'none' 的站点跳过
    if (site.aiInvolvement === "none") {
      throw new Error("站点 AI 参与度为 none，跳过");
    }

    const signal = getAbortSignal();

    console.log(`  🧠 #${site.id} ${site.name} — 智能爬虫`);
    const result = await intelligentCrawl({
      siteUrls: site.urls.length > 0 ? site.urls : [site.name],
      siteName: site.name,
      scope: site.scope,
      render: site.render,
      signal,
    });

    console.log(`    → ${result.articles.length} 篇 · ${result.stats.tokensUsed} tokens · ${result.stats.totalDurationMs}ms`);

    const ready: ReadyArticle[] = result.articles.map((a) => ({
      url: a.url,
      title: a.title,
      body: a.body,
      contentHash: a.contentHash,
      publishedAt: a.publishedAt,
    }));

    const dedup = deduplicateAndSave(ready, site.id, existing, errors);
    return finalizeRun(logId, site.id, dedup);
  } catch (e) {
    const msg = (e as Error).message;
    db.update(schema.runLogs)
      .set({ endedAt: new Date(), status: "error", fetched: 0, skipped: 0, updated: 0, errorCount: 1, message: msg })
      .where(eq(schema.runLogs.id, logId))
      .run();
    return { fetched: 0, skipped: 0, updated: 0, errorCount: 1, status: "error" };
  }
}
