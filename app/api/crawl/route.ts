/**
 * POST /api/crawl  — 手动触发采集（由 Web UI 按钮驱动）。
 *
 * 策略：立即响应，后台并行（按域名分组 + CRAWL_CONCURRENCY 控制并发，与 CLI 一致）。
 * 进度通过 run_logs 表 + GET /api/runs/active 实时展示。
 * 可通过 POST /api/crawl/stop 中止。
 */
import { NextResponse } from "next/server";
import { db, schema } from "@/db/client";
import { eq } from "drizzle-orm";
import PQueue from "p-queue";
import { runSite } from "@/src/pipeline/runner";
import { closeBrowser } from "@/src/crawler/playwright";
import { createAbortController, getAbortSignal } from "@/src/pipeline/abort";
import { analyzePending } from "@/src/ai/analyze";
import type { Site } from "@/src/pipeline/types";

export const dynamic = "force-dynamic";

const CONCURRENCY = Number(process.env.CRAWL_CONCURRENCY ?? 10);

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

export async function POST(req: Request) {
  let siteId: number | undefined;
  try {
    const body = (await req.json().catch(() => ({}))) as { siteId?: number };
    siteId = body.siteId;
  } catch {
    // no body → crawl all
  }

  const targets: Site[] = siteId
    ? db
        .select()
        .from(schema.sites)
        .where(eq(schema.sites.id, siteId))
        .all()
    : db
        .select()
        .from(schema.sites)
        .where(eq(schema.sites.enabled, true))
        .all();

  if (!targets.length) {
    return NextResponse.json(
      { error: siteId ? `站点 #${siteId} 不存在` : "无启用站点" },
      { status: 404 },
    );
  }

  // 只采集 AI 启用的站点（全部走智能爬虫）
  const ready = targets.filter((s) => s.aiInvolvement !== "none");
  const skipped = targets.filter((s) => !ready.includes(s));

  if (!ready.length) {
    return NextResponse.json(
      { error: "所有目标站点均禁用 AI 或未配置", skipped: skipped.map((s) => ({ id: s.id, name: s.name })) },
      { status: 400 },
    );
  }

  // 创建 crawl session
  const sessionId = (
    db
      .insert(schema.crawlSessions)
      .values({
        startedAt: new Date(),
        status: "running",
        siteCount: ready.length,
      })
      .run().lastInsertRowid as number
  ) ?? 1;

  const groups = groupByHost(ready);

  // 立即返回，后台执行
  const q = new PQueue({ concurrency: CONCURRENCY });
  const ac = createAbortController(q);
  let totalFetched = 0;

  for (const group of groups) {
    q.add(async () => {
      // 组内串行（同域名共享限流，并行无益）
      for (const s of group) {
        if (ac.signal.aborted) break;
        try {
          const r = await runSite(s, sessionId);
          totalFetched += r.fetched;
        } catch {
          // runSite 自己已写 run_logs 错误，这里只需抓取不中断
        }
      }
    });
  }

  // 后台跑完之后关浏览器 + 汇总 session + 自动触发 AI 分析
  q.onIdle()
    .then(() => closeBrowser().catch(() => {}))
    .then(() => {
      // 汇总 session 结果
      const sessionRuns = db
        .select()
        .from(schema.runLogs)
        .where(eq(schema.runLogs.crawlSessionId, sessionId))
        .all();
      const totalErrors = sessionRuns.reduce((s, r) => s + r.errorCount, 0);
      const totalUpdated = sessionRuns.reduce((s, r) => s + r.updated, 0);
      const totalSkipped = sessionRuns.reduce((s, r) => s + r.skipped, 0);
      const hasErrors = totalErrors > 0;
      const hasPartial = sessionRuns.some((r) => r.status === "partial");
      const sessionStatus: typeof schema.crawlSessions.$inferInsert.status =
        ac.signal.aborted ? "aborted"
        : hasErrors && totalFetched === 0 ? "error"
        : hasPartial || hasErrors ? "partial"
        : "success";

      db.update(schema.crawlSessions)
        .set({
          endedAt: new Date(),
          status: sessionStatus,
          totalFetched,
          totalUpdated,
          totalSkipped,
          totalErrors,
        })
        .where(eq(schema.crawlSessions.id, sessionId))
        .run();

      if (!ac.signal.aborted) {
        console.log(`[crawl] 完成，共采集 ${totalFetched} 篇新文章 (含更新/跳过)。`);
        // 采集完成后自动对 raw 文章做 AI 分析
        return analyzePending({ concurrency: Number(process.env.CRAWL_CONCURRENCY ?? 3) });
      }
    })
    .then(() => {
      if (!ac.signal.aborted) {
        console.log(`[crawl] AI 分析完成。`);
      }
    })
    .catch(() => {});

  return NextResponse.json({
    started: true,
    targetCount: ready.length,
    groupCount: groups.length,
    concurrency: CONCURRENCY,
    skippedCount: skipped.length,
    skippedNames: skipped.map((s) => s.name),
  });
}
