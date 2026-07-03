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

  let fetched = 0;
  let skipped = 0;
  let updated = 0;
  let errorCount = 0;
  let duplicateCount = 0;
  const errors: string[] = [];

  // 全库已入库文章 → url 到已有记录的映射（用于内容变更检测 + 跨站URL冲突检测）
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
        errorCount++;
        errors.push(`list ${url}: ${(e as Error).message}`);
      }
    }

    // 2) 在列表层按 url 去重（列表页本身可能出现重复链接）
    const seen = new Set<string>();
    const deduped = items.filter((it) => seen.has(it.url) ? false : (seen.add(it.url), true));

    // 3) 详情并行抓取（所有条目都发起请求，existing 的也不跳过，用于检测内容变更）
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

    for (const r of results) {
      if (r.status === "rejected") {
        errorCount++;
        errors.push(`detail: ${(r.reason as Error).message}`);
        continue;
      }
      const val = r.value;
      if (!val) continue;

      // 内容过短 → 跳过（不区分新/旧）
      if ("skipped" in val) {
        skipped++;
        continue;
      }

      const prev = existing.get(val.it.url);

      if (prev) {
        // URL 已存在
        if (prev.siteId !== site.id) {
          // 跨站点 URL 冲突：另一站点已采集此文章，跳过
          duplicateCount++;
          continue;
        }
        // 同站点，对比 contentHash
        if (prev.hash === val.hash) {
          // 内容无变化 → 跳过
          skipped++;
          continue;
        }
        // 内容有变化 → 更新文章并重置为 raw，触发重新 AI 审核
        try {
          db.update(schema.articles)
            .set({
              title: val.d.title,
              body: val.d.body,
              contentHash: val.hash,
              publishedAt: tryParseDate(val.d.date ?? val.it.date) ?? undefined,
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
        // 新 URL → 插入新文章（容忍 UNIQUE 约束冲突）
        try {
          db.insert(schema.articles)
            .values({
              siteId: site.id,
              url: val.it.url,
              title: val.d.title,
              body: val.d.body,
              publishedAt: tryParseDate(val.d.date ?? val.it.date),
              contentHash: val.hash,
              status: "raw",
            })
            .run();
          existing.set(val.it.url, { id: -1, siteId: site.id, hash: val.hash });
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

    const status: RunResult["status"] =
      errorCount > 0 && (fetched > 0 || updated > 0) ? "partial"
      : errorCount > 0 ? "error"
      : duplicateCount > 0 ? "partial"
      : "success";

    const summaryParts: string[] = [];
    if (duplicateCount > 0) summaryParts.push(`dup:${duplicateCount}`);
    const message = errors.slice(0, 5).join(" | ") || null;
    const fullMessage = summaryParts.length > 0
      ? (message ? `${summaryParts.join(" ")} | ${message}` : summaryParts.join(" "))
      : message;

    db.update(schema.runLogs)
      .set({
        endedAt: new Date(),
        status,
        fetched,
        skipped,
        updated,
        errorCount,
        message: fullMessage,
      })
      .where(eq(schema.runLogs.id, logId))
      .run();
    db.update(schema.sites)
      .set({ lastRunAt: new Date() })
      .where(eq(schema.sites.id, site.id))
      .run();

    return { fetched, skipped, updated, errorCount, status };
  } catch (e) {
    const msg = (e as Error).message;
    db.update(schema.runLogs)
      .set({
        endedAt: new Date(),
        status: "error",
        fetched,
        skipped,
        updated,
        errorCount: errorCount + 1,
        message: msg,
      })
      .where(eq(schema.runLogs.id, logId))
      .run();
    return { fetched, skipped, updated, errorCount: errorCount + 1, status: "error" };
  }
}
