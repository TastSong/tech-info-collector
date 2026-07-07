/**
 * 采集服务层 — 抽取 CLI / Web API / Cron 三处共享的采集编排逻辑。
 *
 * 所有入口统一调用 runCrawl()，消除约 80% 的重复代码。
 */
import { eq } from "drizzle-orm";
import PQueue from "p-queue";
import { db, schema } from "../../db/client";
import type { Site } from "./types";
import { runSite, type RunResult } from "./runner";
import { closeBrowser } from "../crawler/playwright";
import { analyzePending } from "../ai/analyze";

export interface CrawlOptions {
  /** 指定站点 ID 采集，省略则采集所有 enabled 站点 */
  siteId?: number;
  /** 跨域名并行数 */
  concurrency?: number;
  /** 是否在采集后自动 AI 分析 */
  autoAnalyze?: boolean;
  /** AbortSignal（从 Web API 传入，用于支持中止） */
  signal?: AbortSignal;
  /** 外部 PQueue（Web API 传入，已注册 AbortController，供 stop API 清空队列） */
  queue?: PQueue;
  /** 进度回调（每次站点完成时调用） */
  onSiteDone?: (site: Site, result: RunResult) => void;
}

export interface CrawlSummary {
  sessionId: number;
  totalFetched: number;
  totalUpdated: number;
  totalSkipped: number;
  totalErrors: number;
  status: "success" | "partial" | "error" | "aborted";
}

/** 按站点首个 url 的 host 分组，同域名站点串行，跨域名并行。 */
function groupByHost(sites: Site[]): Site[][] {
  const map = new Map<string, Site[]>();
  for (const s of sites) {
    let host = "unknown";
    try { host = new URL(s.urls[0]).host; } catch {}
    const list = map.get(host);
    if (list) list.push(s);
    else map.set(host, [s]);
  }
  return [...map.values()];
}

export async function runCrawl(opts: CrawlOptions = {}): Promise<{
  skipped: Site[];
  summary: CrawlSummary;
}> {
  const concurrency = opts.concurrency ?? Number(process.env.CRAWL_CONCURRENCY ?? 10);
  const autoAnalyze = opts.autoAnalyze ?? true;

  // 1. 查询目标站点
  const targets = opts.siteId
    ? db.select().from(schema.sites).where(eq(schema.sites.id, opts.siteId)).all()
    : db.select().from(schema.sites).where(eq(schema.sites.enabled, true)).all();

  if (!targets.length) {
    throw new Error(opts.siteId ? `未找到站点 #${opts.siteId}` : "没有 enabled 的站点");
  }

  // 只采集 AI 启用的站点（aiInvolvement != none），全部走智能爬虫
  const ready = targets.filter((s) => s.aiInvolvement !== "none");
  const skipped = targets.filter((s) => !ready.includes(s));

  for (const s of skipped) {
    console.log(`⊘ #${s.id} ${s.name} — AI 未启用，跳过`);
  }

  if (!ready.length) {
    return {
      skipped,
      summary: { sessionId: 0, totalFetched: 0, totalUpdated: 0, totalSkipped: 0, totalErrors: 0, status: "success" },
    };
  }

  // 2. 创建 crawl session
  const sessionCount = db.select().from(schema.crawlSessions).all().length;
  const sessionIndex = sessionCount + 1;
  const sessionId = (
    db.insert(schema.crawlSessions)
      .values({ startedAt: new Date(), status: "running", siteCount: ready.length })
      .run().lastInsertRowid as number
  ) ?? 1;

  console.log(`\n=== 第 ${sessionIndex} 次采集 ===`);
  console.log(`并行采集 ${ready.length} 站 (${groupByHost(ready).length} 域名组) · 并发=${concurrency}\n`);

  // 3. 按域名分组并行
  const groups = groupByHost(ready);
  const q = opts.queue ?? new PQueue({ concurrency });
  let totalFetched = 0;

  for (const group of groups) {
    q.add(async () => {
      // 组内串行（同域名共享限流队列，并行无益且可能触发反爬）
      for (const s of group) {
        if (opts.signal?.aborted) break;
        process.stdout.write(`▶ #${s.id} ${s.name} [${s.render}] ...`);
        try {
          const r = await runSite(s, sessionId);
          console.log(` ✓ 新${r.fetched} 变${r.updated} 跳${r.skipped} 错${r.errorCount} (${r.status})`);
          totalFetched += r.fetched + r.updated;
          opts.onSiteDone?.(s, r);
        } catch (e) {
          console.log(` ✗ ${(e as Error).message}`);
        }
      }
    });
  }

  await q.onIdle();

  // 4. 关闭浏览器
  if (!opts.signal?.aborted) {
    await closeBrowser().catch(() => {});
  }

  // 5. 汇总 session 结果
  const sessionRuns = db.select()
    .from(schema.runLogs)
    .where(eq(schema.runLogs.crawlSessionId, sessionId))
    .all();
  const totalErrors = sessionRuns.reduce((s, r) => s + r.errorCount, 0);
  const totalUpdated = sessionRuns.reduce((s, r) => s + r.updated, 0);
  const totalSkipped = sessionRuns.reduce((s, r) => s + r.skipped, 0);
  const hasErrors = totalErrors > 0;
  const hasPartial = sessionRuns.some((r) => r.status === "partial");
  const status: CrawlSummary["status"] =
    opts.signal?.aborted ? "aborted"
    : hasErrors && totalFetched === 0 ? "error"
    : hasPartial || hasErrors ? "partial"
    : "success";

  db.update(schema.crawlSessions)
    .set({ endedAt: new Date(), status, totalFetched, totalUpdated, totalSkipped, totalErrors })
    .where(eq(schema.crawlSessions.id, sessionId))
    .run();

  console.log(`\n采集完成，共采集 ${totalFetched} 篇新文章。`);

  // 6. 自动 AI 分析
  if (autoAnalyze && !opts.signal?.aborted) {
    console.log("开始 AI 分析…");
    await analyzePending({ concurrency });
    console.log("AI 分析完成。");
  }

  return {
    skipped,
    summary: { sessionId, totalFetched, totalUpdated, totalSkipped, totalErrors, status },
  };
}
