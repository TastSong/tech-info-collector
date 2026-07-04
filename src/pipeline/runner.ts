/**
 * 采集运行编排（确定性部分）：
 *   逐 url 抓列表页 → 解析条目 → 按 url 去重 → 抓详情页 → 解析正文 → 入库(status=raw)
 *   对已存在的 url：重新抓取对比 contentHash，变化则 UPDATE 并重置 status=raw（触发重新审核）。
 *   全程写 run_logs；按域名限流。
 */
import { eq } from "drizzle-orm";
import { db, schema } from "../../db/client";
import type { Site } from "./types";
import { fetchHtml } from "../crawler/fetcher";
import { parseList, parseDetail } from "../crawler/parser";
import { queueFor } from "../crawler/rate-limit";
import { contentHash } from "./dedup";
import { tryParseDate } from "../lib/date";
import { getAbortSignal } from "./abort";
import { intelligentCrawl, isIntelligentCrawlEnabled } from "../ai/intelligent-crawl";

export interface RunResult {
  fetched: number;
  skipped: number;
  updated: number;
  errorCount: number;
  status: "success" | "partial" | "error";
}

/** 单站单次运行最多抓取的详情数（MVP 控制时长；ithome 首页聚合可达数百条）。 */
const MAX_ITEMS_PER_SITE = 30;

/** 已入库文章的快照：url → {id, siteId, hash} */
type ExistingEntry = { id: number; siteId: number; hash: string };

// ── 共享：去重、contentHash 对比、写入 DB ──

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

/** 对一批文章做去重 + contentHash 对比 + 写入 DB（智能爬虫和选择器爬虫共用） */
function deduplicateAndSave(
  articles: ReadyArticle[],
  siteId: number,
  existing: Map<string, ExistingEntry>,
  errors: string[],
): DedupResult {
  let fetched = 0;
  let skipped = 0;
  let updated = 0;
  let errorCount = 0;
  let duplicateCount = 0;

  for (const article of articles) {
    const prev = existing.get(article.url);

    if (prev) {
      // URL 已存在
      if (prev.siteId !== siteId) {
        duplicateCount++;
        continue;
      }
      if (prev.hash === article.contentHash) {
        skipped++;
        continue;
      }
      // 内容有变化 → 更新
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
      // 新文章
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
        if (msg.includes("UNIQUE constraint")) {
          duplicateCount++;
        } else {
          errorCount++;
          errors.push(`insert: ${msg}`);
        }
      }
    }
  }

  return { fetched, skipped, updated, errorCount, duplicateCount, errors };
}

/** 写入 run_logs + 更新 sites.lastRunAt，返回 RunResult */
function finalizeRun(
  logId: number,
  siteId: number,
  dedup: DedupResult,
): RunResult {
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
    .set({
      endedAt: new Date(),
      status,
      fetched: dedup.fetched,
      skipped: dedup.skipped,
      updated: dedup.updated,
      errorCount: dedup.errorCount,
      message: fullMessage,
    })
    .where(eq(schema.runLogs.id, logId))
    .run();
  db.update(schema.sites)
    .set({ lastRunAt: new Date() })
    .where(eq(schema.sites.id, siteId))
    .run();

  return {
    fetched: dedup.fetched,
    skipped: dedup.skipped,
    updated: dedup.updated,
    errorCount: dedup.errorCount,
    status,
  };
}

// ── 主入口 ──

export async function runSite(
  site: Site,
  crawlSessionId?: number,
): Promise<RunResult> {
  const startedAt = new Date();
  const logId = (
    db
      .insert(schema.runLogs)
      .values({
        siteId: site.id,
        crawlSessionId: crawlSessionId ?? null,
        startedAt,
        status: "running",
      })
      .run().lastInsertRowid as number
  ) ?? 0;

  const errors: string[] = [];

  // 全库已入库文章 → url 到已有记录的映射
  const existing = new Map<string, ExistingEntry>(
    db
      .select({
        url: schema.articles.url,
        id: schema.articles.id,
        siteId: schema.articles.siteId,
        hash: schema.articles.contentHash,
      })
      .from(schema.articles)
      .all()
      .map((r) => [r.url, { id: r.id, siteId: r.siteId, hash: r.hash ?? "" }]),
  );

  const selectors = {
    listSelector: site.listSelector,
    linkSelector: site.linkSelector,
    titleSelector: site.titleSelector,
    bodySelector: site.bodySelector,
    dateSelector: site.dateSelector,
  };

  try {
    // ── 智能爬虫分支：无选择器但 AI 已启用 ──
    if (!site.listSelector && isIntelligentCrawlEnabled() && site.aiInvolvement !== "none") {
      const signal = getAbortSignal();

      console.log(`  🧠 #${site.id} ${site.name} — 使用智能爬虫 (无选择器)`);
      const result = await intelligentCrawl({
        siteUrl: site.urls[0],
        siteName: site.name,
        scope: site.scope,
        render: site.render,
        signal,
      });

      console.log(
        `    → ${result.articles.length} 篇 · ${result.stats.toolCalls} tool调用 · ${result.stats.totalDurationMs}ms`,
      );

      const ready: ReadyArticle[] = result.articles.map((a) => ({
        url: a.url,
        title: a.title,
        body: a.body,
        contentHash: a.contentHash,
        publishedAt: a.publishedAt,
      }));

      const dedup = deduplicateAndSave(ready, site.id, existing, errors);
      return finalizeRun(logId, site.id, dedup);
    }

    if (!site.listSelector) {
      throw new Error("缺少 listSelector，未配置选择器");
    }

    const signal = getAbortSignal();

    // 1) 抓所有列表 url，汇总条目
    const items = [];
    for (const url of site.urls) {
      if (signal?.aborted) throw new DOMException("用户中止", "AbortError");
      try {
        const html = await queueFor(url).add(() =>
          fetchHtml(url, site.render, { waitSelector: site.bodySelector ?? undefined }, signal),
        ) as string;
        items.push(...parseList(html, url, selectors));
      } catch (e) {
        if (signal?.aborted) throw new DOMException("用户中止", "AbortError");
        errors.push(`list ${url}: ${(e as Error).message}`);
      }
    }

    // 2) 在列表层按 url 去重
    const seen = new Set<string>();
    const deduped = items.filter((it) => seen.has(it.url) ? false : (seen.add(it.url), true));

    // 3) 详情并行抓取
    const workItems = deduped.slice(0, MAX_ITEMS_PER_SITE);
    const tasks = workItems.map((it) =>
      queueFor(it.url).add(async () => {
        if (signal?.aborted) throw new DOMException("用户中止", "AbortError");
        try {
          const html = await fetchHtml(it.url, site.render, {}, signal);
          const d = parseDetail(html, selectors);
          if (!d.title || d.body.length < 50) return { skipped: true } as const;
          const hash = contentHash(d.body);
          return { it, d, hash } as const;
        } catch (e) {
          if (signal?.aborted) throw new DOMException("用户中止", "AbortError");
          throw e;
        }
      }),
    );

    const results = await Promise.allSettled(tasks);
    let errorCount = 0;

    const ready: ReadyArticle[] = [];
    for (const r of results) {
      if (r.status === "rejected") {
        errorCount++;
        errors.push(`detail: ${(r.reason as Error).message}`);
        continue;
      }
      const val = r.value;
      if (!val) continue;
      if ("skipped" in val) continue;

      const publishedAt = tryParseDate(val.d.date ?? val.it.date);
      ready.push({
        url: val.it.url,
        title: val.d.title,
        body: val.d.body,
        contentHash: val.hash,
        publishedAt,
      });
    }

    const dedup = deduplicateAndSave(ready, site.id, existing, errors);
    dedup.errorCount += errorCount;
    return finalizeRun(logId, site.id, dedup);
  } catch (e) {
    const msg = (e as Error).message;
    db.update(schema.runLogs)
      .set({
        endedAt: new Date(),
        status: "error",
        fetched: 0,
        skipped: 0,
        updated: 0,
        errorCount: 1,
        message: msg,
      })
      .where(eq(schema.runLogs.id, logId))
      .run();
    return { fetched: 0, skipped: 0, updated: 0, errorCount: 1, status: "error" };
  }
}
