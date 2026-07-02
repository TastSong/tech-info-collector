/**
 * 采集运行编排（确定性部分）：
 *   逐 url 抓列表页 → 解析条目 → 按 url 去重 → 抓详情页 → 解析正文 → 入库(status=raw)
 *   全程写 run_logs；按域名限流。
 * 阶段 2 暂不接 AI（文章落 raw）；阶段 3 在此之后挂 AI 沙盒闸门。
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
  errorCount: number;
  status: "success" | "partial" | "error";
}

/** 单站单次运行最多抓取的详情数（MVP 控制时长；ithome 首页聚合可达数百条）。 */
const MAX_ITEMS_PER_SITE = 30;

export async function runSite(site: Site): Promise<RunResult> {
  const startedAt = new Date();
  const logId = (
    db
      .insert(schema.runLogs)
      .values({ siteId: site.id, startedAt, status: "running" })
      .run().lastInsertRowid as number
  ) ?? 0;

  let fetched = 0;
  let skipped = 0;
  let errorCount = 0;
  const errors: string[] = [];

  // 该站点已采集的 url（避免重复抓取 + 同次运行内去重）
  const existing = new Set(
    db
      .select({ url: schema.articles.url })
      .from(schema.articles)
      .where(eq(schema.articles.siteId, site.id))
      .all()
      .map((r) => r.url),
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
        );
        items.push(...parseList(html, url, selectors));
      } catch (e) {
        if (signal?.aborted) throw new DOMException("用户中止", "AbortError");
        errorCount++;
        errors.push(`list ${url}: ${(e as Error).message}`);
      }
    }

    // 2) 逐条抓详情 + 入库（控制在 MAX_ITEMS 以内）
    const workItems = items.slice(0, MAX_ITEMS_PER_SITE);
    for (const it of workItems) {
      if (signal?.aborted) throw new DOMException("用户中止", "AbortError");
      if (existing.has(it.url)) {
        skipped++;
        continue;
      }
      try {
        const html = await queueFor(it.url).add(() =>
          fetchHtml(it.url, site.render, {}, signal),
        );
        const d = parseDetail(html, selectors);
        if (!d.title || d.body.length < 50) {
          skipped++;
          continue;
        }
        db.insert(schema.articles)
          .values({
            siteId: site.id,
            url: it.url,
            title: d.title,
            body: d.body,
            publishedAt: tryParseDate(d.date ?? it.date),
            contentHash: contentHash(d.body),
            status: "raw",
          })
          .run();
        existing.add(it.url);
        fetched++;
      } catch (e) {
        if (signal?.aborted) throw new DOMException("用户中止", "AbortError");
        errorCount++;
        errors.push(`detail ${it.url}: ${(e as Error).message}`);
      }
    }

    const status: RunResult["status"] =
      errorCount > 0 && fetched > 0 ? "partial" : errorCount > 0 ? "error" : "success";

    db.update(schema.runLogs)
      .set({
        endedAt: new Date(),
        status,
        fetched,
        skipped,
        errorCount,
        message: errors.slice(0, 5).join(" | ") || null,
      })
      .where(eq(schema.runLogs.id, logId))
      .run();
    db.update(schema.sites)
      .set({ lastRunAt: new Date() })
      .where(eq(schema.sites.id, site.id))
      .run();

    return { fetched, skipped, errorCount, status };
  } catch (e) {
    db.update(schema.runLogs)
      .set({
        endedAt: new Date(),
        status: "error",
        fetched,
        skipped,
        errorCount,
        message: (e as Error).message,
      })
      .where(eq(schema.runLogs.id, logId))
      .run();
    return { fetched, skipped, errorCount, status: "error" };
  }
}
