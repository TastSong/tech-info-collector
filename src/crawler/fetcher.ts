/**
 * HTML 抓取器。
 * - static：原生 fetch（undici），自动处理 GBK/GB2312 等非 utf-8 编码（政府站常见）
 * - dynamic：委托给 Playwright（见 playwright.ts）
 * 自动指数退避重试（最多 3 次，政府对 502/503/连接失败有效）
 */
import { fetchDynamic } from "./playwright";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export type RenderMode = "static" | "dynamic";

export interface FetchOpts {
  timeoutMs?: number;
  waitSelector?: string;
  /** 最大重试次数，默认 3 */
  maxRetries?: number;
}

/** 可重试的错误：5xx、连接失败、网络超时等 */
function isRetryable(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  // HTTP 5xx 和网络层错误都可重试
  return /HTTP 5\d\d|fetch failed|ETIMEDOUT|ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|timeout/i.test(msg);
}

/** 指数退避延迟：1s → 2s → 4s */
function backoff(attempt: number): number {
  return Math.min(1000 * 2 ** attempt, 8000);
}

export async function fetchHtml(
  url: string,
  mode: RenderMode,
  opts: FetchOpts = {},
  externalSignal?: AbortSignal,
): Promise<string> {
  if (mode === "dynamic") return fetchDynamic(url, opts, externalSignal);

  const maxRetries = opts.maxRetries ?? 3;
  let lastErr: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      const delay = backoff(attempt - 1);
      console.log(`  ↻ retry ${attempt}/${maxRetries} for ${url} after ${delay}ms`);
      await new Promise((r) => setTimeout(r, delay));
    }

    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 30000);

      const onExternalAbort = () => ctl.abort();
      externalSignal?.addEventListener("abort", onExternalAbort, { once: true });

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
        const sniff = buf.toString("latin1");
        const ct = res.headers.get("content-type") || "";
        const fromHeader = /charset=([\w-]+)/i.exec(ct)?.[1];
        const fromMeta = /<meta[^>]+charset=["']?([\w-]+)/i.exec(sniff)?.[1];
        const charset = (fromHeader || fromMeta || "utf-8").toLowerCase();
        return decode(buf, charset);
      } finally {
        clearTimeout(timer);
        externalSignal?.removeEventListener("abort", onExternalAbort);
      }
    } catch (e) {
      if (externalSignal?.aborted) throw new DOMException("用户中止", "AbortError");
      lastErr = e;
      if (!isRetryable(e) || attempt >= maxRetries) throw e;
    }
  }

  throw lastErr;
}

function decode(buf: Buffer, charset: string): string {
  // Node 自带 ICU 支持 gbk / gb2312 / gb18030 等
  try {
    return new TextDecoder(charset).decode(buf);
  } catch {
    return buf.toString("utf-8");
  }
}
