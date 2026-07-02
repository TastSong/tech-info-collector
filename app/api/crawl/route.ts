/**
 * POST /api/crawl  — 手动触发采集（由 Web UI 按钮驱动）。
 *
 * 策略：立即响应，后台并行（按域名分组 + CRAWL_CONCURRENCY 控制并发，与 CLI 一致）。
 * 进度通过 run_logs 表 + GET /api/runs/active 实时展示。
 */
import { NextResponse } from "next/server";
import { db, schema } from "@/db/client";
import { eq } from "drizzle-orm";
import PQueue from "p-queue";
import { runSite } from "@/src/pipeline/runner";
import { closeBrowser } from "@/src/crawler/playwright";
import type { Site } from "@/src/pipeline/types";

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

  const ready = targets.filter((s) => s.listSelector);
  const skipped = targets.filter((s) => !s.listSelector);

  if (!ready.length) {
    return NextResponse.json(
      { error: "所有目标站点均未配置选择器", skipped: skipped.map((s) => ({ id: s.id, name: s.name })) },
      { status: 400 },
    );
  }

  const groups = groupByHost(ready);

  // 立即返回，后台执行
  const q = new PQueue({ concurrency: CONCURRENCY });
  let totalFetched = 0;

  for (const group of groups) {
    q.add(async () => {
      // 组内串行（同域名共享限流，并行无益）
      for (const s of group) {
        try {
          const r = await runSite(s);
          totalFetched += r.fetched;
        } catch {
          // runSite 自己已写 run_logs 错误，这里只需抓取不中断
        }
      }
    });
  }

  // 后台跑完之后关浏览器（不阻塞响应）
  q.onIdle()
    .then(() => closeBrowser().catch(() => {}))
    .then(() => {
      console.log(`[crawl] 完成，共采集 ${totalFetched} 篇新文章。`);
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
