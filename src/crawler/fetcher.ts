/**
 * HTML 抓取器。
 * - static：原生 fetch（undici），自动处理 GBK/GB2312 等非 utf-8 编码（政府站常见）
 * - dynamic：委托给 Playwright（见 playwright.ts）
 */
import { fetchDynamic } from "./playwright";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export type RenderMode = "static" | "dynamic";

export interface FetchOpts {
  timeoutMs?: number;
  waitSelector?: string;
}

export async function fetchHtml(
  url: string,
  mode: RenderMode,
  opts: FetchOpts = {},
): Promise<string> {
  if (mode === "dynamic") return fetchDynamic(url, opts);

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 30000);
  try {
    const res = await fetch(url, {
      headers: {
        "user-agent": UA,
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
      },
      redirect: "follow",
      signal: ctl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);

    const buf = Buffer.from(await res.arrayBuffer());
    // 1) 先按 latin1 读出字节（保持 ASCII 范围），用于嗅探 meta charset
    const sniff = buf.toString("latin1");
    const ct = res.headers.get("content-type") || "";
    const fromHeader = /charset=([\w-]+)/i.exec(ct)?.[1];
    const fromMeta = /<meta[^>]+charset=["']?([\w-]+)/i.exec(sniff)?.[1];
    const charset = (fromHeader || fromMeta || "utf-8").toLowerCase();
    return decode(buf, charset);
  } finally {
    clearTimeout(timer);
  }
}

function decode(buf: Buffer, charset: string): string {
  // Node 自带 ICU 支持 gbk / gb2312 / gb18030 等
  try {
    return new TextDecoder(charset).decode(buf);
  } catch {
    return buf.toString("utf-8");
  }
}
