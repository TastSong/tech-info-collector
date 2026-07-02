/**
 * POST /api/crawl  — 手动触发采集（确定性操作，由 Web UI 按钮驱动）。
 * 返回状态消息；实际采集在服务器端同步执行（MVP 粒度，后期可换成异步队列）。
 */
import { NextResponse } from "next/server";
import { db, schema } from "@/db/client";
import { eq } from "drizzle-orm";
import { runSite } from "@/src/pipeline/runner";
import { closeBrowser } from "@/src/crawler/playwright";
import type { Site } from "@/src/pipeline/types";

export async function POST(req: Request) {
  let siteId: number | undefined;
  try {
    const body = (await req.json().catch(() => ({}))) as { siteId?: number };
    siteId = body.siteId;
  } catch {
    // no body → crawl all
  }

  try {
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

    const results = [];
    for (const s of targets) {
      if (!s.listSelector) {
        results.push({ siteId: s.id, name: s.name, fetched: 0, error: "未配置选择器" });
        continue;
      }
      const r = await runSite(s);
      results.push({ siteId: s.id, name: s.name, ...r });
    }

    await closeBrowser()
      .catch(() => { /* 浏览器可能未启动，忽略 */ });

    const totalFetched = results.reduce((s, r) => s + (r.fetched ?? 0), 0);
    return NextResponse.json({ results, totalFetched });
  } catch (e) {
    await closeBrowser().catch(() => {});
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 500 },
    );
  }
}
