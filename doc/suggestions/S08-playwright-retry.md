# S08: Playwright 获取添加重试逻辑

**关联分析**: [ANALYSIS.md](../ANALYSIS.md) → §8.1 短期改进

**优先级**: P2（中等）  
**涉及文件**: `src/crawler/playwright.ts`, `src/crawler/fetcher.ts`  
**预估工时**: 3h

---

## 原因

### 当前行为

```typescript
// src/crawler/playwright.ts
export async function fetchDynamic(url, opts, externalSignal) {
  const browser = await getBrowser();
  const context = await browser.newContext({ userAgent: UA, locale: "zh-CN" });
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    if (opts.waitSelector) {
      await page.waitForSelector(opts.waitSelector, { timeout: 15000 }).catch(() => {});
    } else {
      await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    }
    await page.waitForTimeout(800);
    return await page.content();
  } finally {
    await context.close();
  }
}
```

对比 static 采集（`fetcher.ts`）有 **最多 3 次重试 + SSL 回退**，而 dynamic 采集**完全没有重试**。

### 风险评估

- **Chromium 崩溃**：Docker 内存不足时 Playwright 的 Chromium 可能崩溃，`getBrowser()` 的单例会一直返回已崩溃的实例
- **页面导航超时**：某些动态站点响应慢，`goto` 45 秒超时后直接失败
- **网络波动**：动态站点的 CDN/JS 资源加载可能偶发失败
- **资源泄漏**：虽然有 `finally { context.close() }`，但如果 `goto` 超时，page 可能留下未关闭的资源

### 设计目标

1. 动态抓取支持指数退避重试（最多 2 次）
2. 浏览器崩溃后自动重启
3. 增加超时配置
4. 改进错误分类（可重试 vs 不可重试）

---

## 详细修改步骤

### 步骤 1：为 `fetchDynamic` 添加重试

```typescript
// src/crawler/playwright.ts
import type { FetchOpts } from "./fetcher";

export async function fetchDynamic(
  url: string,
  opts: FetchOpts = {},
  externalSignal?: AbortSignal,
): Promise<string> {
  const maxRetries = opts.maxRetries ?? 2; // 默认重试 2 次
  const timeoutMs = opts.timeoutMs ?? 45000;
  let lastErr: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      const delay = Math.min(2000 * 2 ** (attempt - 1), 8000);
      console.log(`  ↻ dynamic retry ${attempt}/${maxRetries} for ${url} after ${delay}ms`);
      await new Promise(r => setTimeout(r, delay));
    }

    if (externalSignal?.aborted) {
      throw new DOMException("用户中止", "AbortError");
    }

    try {
      return await fetchDynamicOnce(url, opts, timeoutMs, externalSignal);
    } catch (e) {
      lastErr = e;
      
      // 浏览器崩溃 → 关闭并重启
      if (isBrowserCrash(e)) {
        console.log(`  ⚠ Browser may have crashed, restarting...`);
        await closeBrowser();
        // 浏览器重启算作一次重试
        continue;
      }

      // 不可重试的错误（如 HTTP 404）→ 直接抛出
      if (!isRetryableDynamicError(e)) {
        throw e;
      }

      // 最后一次尝试 → 抛出
      if (attempt >= maxRetries) throw e;
    }
  }

  throw lastErr;
}
```

### 步骤 2：分离单次抓取逻辑

```typescript
async function fetchDynamicOnce(
  url: string,
  opts: FetchOpts,
  timeoutMs: number,
  externalSignal?: AbortSignal,
): Promise<string> {
  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent: UA,
    locale: "zh-CN",
  });
  const page = await context.newPage();
  
  try {
    // 监听外部中止信号
    if (externalSignal) {
      const onAbort = () => {
        page.close().catch(() => {});
        context.close().catch(() => {});
      };
      externalSignal.addEventListener("abort", onAbort, { once: true });
    }

    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: timeoutMs,
    });

    if (opts.waitSelector) {
      await page
        .waitForSelector(opts.waitSelector, { timeout: 15000 })
        .catch(() => {});
    } else {
      await page
        .waitForLoadState("networkidle", { timeout: 15000 })
        .catch(() => {});
    }

    await page.waitForTimeout(800);
    const content = await page.content();
    
    // 检查是否获取到有效内容
    if (!content || content.length < 500) {
      throw new Error("dynamic fetch returned empty or too-short content");
    }
    
    return content;
  } finally {
    await context.close().catch(() => {});
  }
}
```

### 步骤 3：实现错误分类

```typescript
function isBrowserCrash(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /Target closed|Browser closed|Protocol error|Session closed|Connection closed/i.test(msg);
}

function isRetryableDynamicError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    /timeout|ETIMEDOUT|ECONNRESET|net::ERR_|NS_ERROR_NET|Navigation failed/i.test(msg) ||
    /empty or too-short/i.test(msg)
  );
}
```

### 步骤 4：更新 `FetchOpts` 类型

```typescript
// src/crawler/fetcher.ts
export interface FetchOpts {
  timeoutMs?: number;
  waitSelector?: string;
  /** 最大重试次数，默认 static: 3, dynamic: 2 */
  maxRetries?: number;
}
```

### 步骤 5：验证

1. 正常 dynamic 站点采集（如 36氪）不受影响
2. 模拟超时：临时将 `timeoutMs` 设为 1，确认重试日志输出
3. 模拟浏览器崩溃：`docker compose exec app pkill chromium` 后确认自动重启
4. 不可重试错误（如 URL 不存在）直接抛出
5. 外部中止信号仍有效

---

## 影响范围

| 影响 | 说明 |
|---|---|
| 健壮性 | 显著提升：dynamic 站点偶发超时可以自动恢复 |
| 采集时间 | 失败时增加 2s→4s 等待，最坏多 6s |
| 浏览器实例 | 崩溃时自动重启，避免后续所有 dynamic 站点失败 |
| 兼容性 | 完全向后兼容 |
