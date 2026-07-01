/**
 * 可插拔通知器（MVP：console log + 可选 webhook）。
 * 后续可换 Email/钉钉/飞书等，只需实现 Notify 接口。
 *
 * 环境变量：
 *   NOTIFY_WEBHOOK_URL  — POST JSON 到此地址；未设则仅打印日志。
 */

export interface RunSummary {
  type: "scheduled_run" | "manual_crawl" | "manual_analyze";
  crawled?: number;
  analyzed?: number;
  durationSec?: number;
}

export interface Notify {
  fire(summary: RunSummary): Promise<void>;
}

/** 控制台日志（始终启用） */
const logNotify: Notify = {
  async fire(s) {
    console.log(`[notify] ${s.type} crawled=${s.crawled} analyzed=${s.analyzed} ${s.durationSec}s`);
  },
};

/** 可选 webhook（NOTIFY_WEBHOOK_URL 设了才生效） */
const webhookNotify: Notify = {
  async fire(s) {
    const url = process.env.NOTIFY_WEBHOOK_URL;
    if (!url) return;
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(s),
    });
  },
};

export async function fire(summary: RunSummary): Promise<void> {
  await Promise.all([logNotify.fire(summary), webhookNotify.fire(summary).catch(() => {})]);
}
