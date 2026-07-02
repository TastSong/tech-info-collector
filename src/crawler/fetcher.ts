/**
 * HTML 抓取器。
 * - static：原生 http/https 模块（支持跨协议重定向、弱SSL站点、GBK编码）
 * - dynamic：委托给 Playwright（见 playwright.ts）
 * 自动指数退避重试（最多 3 次）。
 *
 * 为什么用 http/https 而非 undici fetch：
 *   undici 不支持 HTTP→HTTPS 跨协议重定向（moj.gov.cn 等）；
 *   且无法禁用 ECDHE 密码套件（stic.sz.gov.cn 的 bad ecpoint 会被 OpenSSL 3.x 拒绝）。
 */
import { fetchDynamic } from "./playwright";
import * as http from "http";
import * as https from "https";

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

/** TLS 容错 Agent：
 *  - rejectUnauthorized: false → 容忍过期/不完整证书（sanden, gfhr）
 *  - 禁用 ECDHE/ECDH 密码套件 → 绕过 stic.sz.gov.cn 的 bad ecpoint */
const TLS_AGENT = new https.Agent({
  rejectUnauthorized: false,
  // 仅使用非 EC 密码套件，避免服务器 bad ecpoint 导致 OpenSSL 3.x 拒绝握手
  ciphers:
    "AES256-GCM-SHA384:AES128-GCM-SHA256:" +
    "AES256-SHA256:AES128-SHA256:AES256-SHA:AES128-SHA:" +
    "HIGH:!aNULL:!eNULL:!EXPORT:!DES:!MD5:!PSK:!RC4:!DHE:!ECDHE:!ECDH",
  secureProtocol: "TLSv1_2_method",
});

/** 可重试的错误：5xx、连接失败、网络超时等 */
function isRetryable(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
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
      return await nativeFetch(url, opts.timeoutMs ?? 30000, externalSignal);
    } catch (e) {
      if (externalSignal?.aborted) throw new DOMException("用户中止", "AbortError");
      lastErr = e;
      if (!isRetryable(e) || attempt >= maxRetries) throw e;
    }
  }

  throw lastErr;
}

/** 原生 http/https 抓取，支持跨协议重定向（最多 8 跳，含 cookie 转发）、GBK 编码识别 */
function nativeFetch(
  url: string,
  timeoutMs: number,
  externalSignal?: AbortSignal,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      reject(new Error("timeout"));
    }, timeoutMs);

    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("用户中止", "AbortError"));
    };
    externalSignal?.addEventListener("abort", onAbort, { once: true });

    doRequest(url, 0, "");

    function doRequest(currentUrl: string, redirectCount: number, cookieHeader: string) {
      if (timedOut) return;
      if (externalSignal?.aborted) { onAbort(); return; }
      if (redirectCount > 8) {
        clearTimeout(timer);
        externalSignal?.removeEventListener("abort", onAbort);
        reject(new Error("redirect count exceeded"));
        return;
      }

      const isHttps = currentUrl.startsWith("https:");
      const mod = isHttps ? https : http;

      const headers: Record<string, string> = {
        "user-agent": UA,
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
      };
      // 重定向时转发 cookie（某些站点如 moj.gov.cn 靠 cookie 终止重定向循环）
      if (cookieHeader) headers["cookie"] = cookieHeader;

      const req = mod.get(
        currentUrl,
        {
          agent: isHttps ? TLS_AGENT : undefined,
          headers,
        },
        (res) => {
          // 收集 Set-Cookie 用于后续重定向
          const setCookie = res.headers["set-cookie"];
          const mergedCookie = mergeCookies(cookieHeader, setCookie);

          // 处理重定向（包括 HTTP→HTTPS 跨协议）
          const loc = res.headers.location;
          if (res.statusCode && res.statusCode >= 301 && res.statusCode <= 308 && loc) {
            // 消耗响应体
            res.resume();
            try {
              const next = new URL(loc, currentUrl).toString();
              doRequest(next, redirectCount + 1, mergedCookie);
            } catch {
              clearTimeout(timer);
              externalSignal?.removeEventListener("abort", onAbort);
              reject(new Error(`Invalid redirect location: ${loc}`));
            }
            return;
          }

          if (!res.statusCode || res.statusCode >= 500) {
            res.resume();
            clearTimeout(timer);
            externalSignal?.removeEventListener("abort", onAbort);
            reject(new Error(`HTTP ${res.statusCode ?? "???"} ${res.statusMessage ?? ""}`));
            return;
          }

          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () => {
            clearTimeout(timer);
            externalSignal?.removeEventListener("abort", onAbort);
            const buf = Buffer.concat(chunks);
            const sniff = buf.toString("latin1");
            const ct = res.headers["content-type"] || "";
            const fromHeader = /charset=([\w-]+)/i.exec(ct)?.[1];
            const fromMeta = /<meta[^>]+charset=["']?([\w-]+)/i.exec(sniff)?.[1];
            const charset = (fromHeader || fromMeta || "utf-8").toLowerCase();
            resolve(decode(buf, charset));
          });
          res.on("error", (e) => {
            clearTimeout(timer);
            externalSignal?.removeEventListener("abort", onAbort);
            reject(e);
          });
        },
      );

      req.on("error", (e: NodeJS.ErrnoException) => {
        clearTimeout(timer);
        externalSignal?.removeEventListener("abort", onAbort);
        // 将 Node 错误包装为可重试检测格式
        reject(new Error(`${e.code ?? "fetch failed"}: ${e.message}`));
      });

      req.on("timeout", () => {
        req.destroy();
        clearTimeout(timer);
        externalSignal?.removeEventListener("abort", onAbort);
        reject(new Error("ETIMEDOUT"));
      });

      req.setTimeout(timeoutMs);
    }
  });
}

/** 合并新旧 Set-Cookie 到单行 cookie header（仅保留 name=value，丢弃过期/路径/域名等属性） */
function mergeCookies(existing: string, setCookie: string[] | undefined): string {
  if (!setCookie || setCookie.length === 0) return existing;
  const map = new Map<string, string>();
  // 先解析已有 cookie
  for (const part of existing.split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0) map.set(part.slice(0, eq).trim(), part.slice(eq + 1).trim());
  }
  // 新 Set-Cookie 覆盖/追加（只取 name=value，不要属性）
  for (const sc of setCookie) {
    const eq = sc.indexOf("=");
    const semi = sc.indexOf(";");
    if (eq > 0) {
      const name = sc.slice(0, eq).trim();
      const value = semi > eq ? sc.slice(eq + 1, semi).trim() : sc.slice(eq + 1).trim();
      map.set(name, value);
    }
  }
  return [...map.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

function decode(buf: Buffer, charset: string): string {
  try {
    return new TextDecoder(charset).decode(buf);
  } catch {
    return buf.toString("utf-8");
  }
}
