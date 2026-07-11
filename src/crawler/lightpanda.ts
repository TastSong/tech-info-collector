/**
 * Lightpanda 无头浏览器客户端 — 通过 CDP WebSocket 协议连接。
 *
 * 与 playwright.ts 保持相同接口签名，方便 fetcher.ts 统一调用。
 * Lightpanda 是独立 Docker 服务，自带连接池（服务端多路复用），
 * 无需客户端 browser pool。
 *
 * 注意：Lightpanda 不支持 locale/geolocation/timezone 等 Emulation 域，
 * 因此 newContext 时仅设置 userAgent。
 */
import { type Browser } from "playwright";
import { chromium } from "playwright";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/** Lightpanda CDP WebSocket 地址 */
function getEndpoint(): string {
  return process.env.LIGHTPANDA_WS_ENDPOINT ?? "ws://127.0.0.1:9222/";
}

let browser: Browser | null = null;

/** 连接到 Lightpanda CDP 服务器，复用连接 */
export async function getLightpandaBrowser(): Promise<Browser> {
  if (!browser || !browser.isConnected()) {
    const wsEndpoint = getEndpoint();
    console.log(`  🔌 connecting to Lightpanda: ${wsEndpoint}`);
    // 连接超时 10s，避免 Lightpanda 不可用时永久挂起
    browser = await Promise.race([
      chromium.connectOverCDP(wsEndpoint),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Lightpanda connection timeout")), 10_000)
      ),
    ]);
  }
  return browser;
}

/** 使用 Lightpanda 抓取页面 HTML */
export async function fetchWithLightpanda(
  url: string,
  opts: { timeoutMs?: number; waitSelector?: string } = {},
  externalSignal?: AbortSignal,
): Promise<string> {
  const browser = await getLightpandaBrowser();
  // Lightpanda 不支持 locale/geolocation/timezone 等 Emulation 域
  const context = await browser.newContext({ userAgent: UA });
  const page = await context.newPage();
  try {
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: opts.timeoutMs ?? 30_000,
    });
    if (opts.waitSelector) {
      await page
        .waitForSelector(opts.waitSelector, { timeout: 10_000 })
        .catch(() => {});
    } else {
      await page
        .waitForLoadState("networkidle", { timeout: 10_000 })
        .catch(() => {});
    }
    await page.waitForTimeout(300);
    return await page.content();
  } finally {
    await context.close();
  }
}

/** 断开 Lightpanda CDP 连接 */
export async function closeLightpanda(): Promise<void> {
  if (browser) {
    await browser.close().catch(() => {});
    browser = null;
  }
}
