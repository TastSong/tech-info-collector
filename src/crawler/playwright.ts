/**
 * Playwright 浏览器池（懒加载单例）—— 仅用于 render=dynamic 的 JS 渲染站点。
 * 复用同一个 browser 实例，每次抓取开独立 context 隔离 cookie/缓存。
 */
import { chromium, type Browser } from "playwright";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

let browser: Browser | null = null;

export async function getBrowser(): Promise<Browser> {
  if (!browser) {
    browser = await chromium.launch({ headless: true });
  }
  return browser;
}

export async function fetchDynamic(
  url: string,
  opts: { timeoutMs?: number; waitSelector?: string } = {},
  externalSignal?: AbortSignal,
): Promise<string> {
  const browser = await getBrowser();
  const context = await browser.newContext({ userAgent: UA, locale: "zh-CN" });
  const page = await context.newPage();
  try {
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: opts.timeoutMs ?? 45000,
    });
    if (opts.waitSelector) {
      await page
        .waitForSelector(opts.waitSelector, { timeout: 15000 })
        .catch(() => {});
    } else {
      // networkidle 对 SPA 比较稳；失败也不致命
      await page
        .waitForLoadState("networkidle", { timeout: 15000 })
        .catch(() => {});
    }
    await page.waitForTimeout(800);
    return await page.content();
  } finally {
    await context.close();
  }
}

export async function closeBrowser(): Promise<void> {
  if (browser) {
    await browser.close();
    browser = null;
  }
}
