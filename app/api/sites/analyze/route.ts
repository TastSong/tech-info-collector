/**
 * POST /api/sites/analyze — AI 驱动的站点结构分析。
 *
 * 接收站点名称和 URL 列表，返回：
 *   - 渲染模式（静态/动态，优先静态）
 *   - CSS 选择器（列表、条目、链接、标题、正文、日期）
 *   - 分类/子分类/关注范围
 *   - 示例文章链接和诊断信息
 *
 * 由中间件自动进行认证保护（/api/sites/* 需要 auth_token cookie）。
 */
import { NextResponse } from "next/server";
import { analyzeSite } from "@/src/ai/site-analyzer";
import { requireAdmin } from "@/src/lib/auth";

export const dynamic = "force-dynamic";

/** 总分析超时 (ms) */
const ANALYZE_TIMEOUT_MS = 90_000;

export async function POST(req: Request) {
  // admin only 检查
  const user = await requireAdmin();
  if (user instanceof NextResponse) return user;

  // 1) 解析请求体
  let body: { name?: string; urls?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }

  // 2) 校验 name
  if (!body.name || typeof body.name !== "string" || !body.name.trim()) {
    return NextResponse.json({ error: "name 必填" }, { status: 400 });
  }

  // 3) 校验 urls
  if (!Array.isArray(body.urls) || body.urls.length === 0) {
    return NextResponse.json({ error: "urls 数组必填" }, { status: 400 });
  }

  const validUrls = body.urls.filter((u) => {
    if (typeof u !== "string" || !u.trim()) return false;
    try {
      new URL(u.trim());
      return true;
    } catch {
      return false;
    }
  });

  if (validUrls.length === 0) {
    return NextResponse.json({ error: "至少需要一个有效 URL" }, { status: 400 });
  }

  // 4) 运行分析（带超时保护）
  try {
    const result = await withTimeout(
      analyzeSite({
        name: body.name.trim(),
        urls: validUrls.slice(0, 5),
      }),
      ANALYZE_TIMEOUT_MS,
    );

    return NextResponse.json(result);
  } catch (e) {
    const msg = (e as Error).message;

    if (msg.includes("AbortError") || msg.includes("timeout") || msg.includes("超时")) {
      return NextResponse.json(
        { error: "分析超时，请稍后重试" },
        { status: 504 },
      );
    }

    if (msg.includes("无法抓取")) {
      return NextResponse.json(
        { error: msg },
        { status: 500 },
      );
    }

    console.error("analyze site error:", e);
    return NextResponse.json(
      { error: `分析失败: ${msg}` },
      { status: 500 },
    );
  }
}

/** 带超时的 Promise 包装 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("操作超时")), ms);
    promise.then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}
