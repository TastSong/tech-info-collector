/**
 * POST /api/crawl  — 手动触发采集（由 Web UI 按钮驱动）。
 *
 * 策略：立即响应，后台执行（通过 runCrawl 服务层，与 CLI/cron 共享编排逻辑）。
 * 进度通过 run_logs 表 + GET /api/runs/active 实时展示。
 * 可通过 POST /api/crawl/stop 中止。
 */
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import PQueue from "p-queue";
import { db, schema } from "@/db/client";
import { createAbortController } from "@/src/pipeline/abort";
import { runCrawl } from "@/src/pipeline/service";

export const dynamic = "force-dynamic";

const CONCURRENCY = Number(process.env.CRAWL_CONCURRENCY ?? 10);

export async function POST(req: Request) {
  let siteId: number | undefined;
  try {
    const body = (await req.json().catch(() => ({}))) as { siteId?: number };
    siteId = body.siteId;
  } catch {
    // no body → crawl all
  }

  // 快速校验：检查目标站点是否存在
  const targets = siteId
    ? db.select().from(schema.sites).where(eq(schema.sites.id, siteId)).all()
    : db.select().from(schema.sites).where(eq(schema.sites.enabled, true)).all();

  if (!targets.length) {
    return NextResponse.json(
      { error: siteId ? `站点 #${siteId} 不存在` : "无启用站点" },
      { status: 404 },
    );
  }

  const ready = targets.filter((s) => s.aiInvolvement !== "none");
  const skipped = targets.filter((s) => !ready.includes(s));
  const skippedNames = skipped.map((s) => s.name);

  if (!ready.length) {
    return NextResponse.json(
      { error: "所有目标站点均禁用 AI 或未配置", skippedNames },
      { status: 400 },
    );
  }

  // 创建 PQueue 并注册 AbortController（供 stop API 使用）
  const q = new PQueue({ concurrency: CONCURRENCY });
  const ac = createAbortController(q);

  // 后台执行采集 + 分析，不阻塞响应
  runCrawl({
    siteId,
    concurrency: CONCURRENCY,
    autoAnalyze: true,
    signal: ac.signal,
    queue: q,
  })
    .then(({ summary }) => {
      console.log(`[crawl] 完成，session #${summary.sessionId}，共采集 ${summary.totalFetched} 篇 (status=${summary.status})`);
    })
    .catch((e) => {
      console.error(`[crawl] 后台采集失败: ${(e as Error).message}`);
    });

  return NextResponse.json({
    started: true,
    skippedNames,
  });
}
