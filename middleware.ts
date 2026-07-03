import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * 轻量中间件：仅检查 auth_token cookie 是否存在。
 * 真正的 token 验证由 layout（Node.js runtime，可用 better-sqlite3）完成。
 *
 * - 无 cookie → 重定向到 /login（不包括 /login 和 /api/auth 自身）
 * - 有 cookie → 放行，layout 会校验 token 有效性
 * - 已登录访问 /login → 重定向到 /
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 公开路径：无需认证
  const publicPaths = ["/login", "/api/auth"];
  const isPublic = publicPaths.some((p) => pathname.startsWith(p));

  // 静态资源放行
  const isStatic =
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    /\.(ico|png|svg|jpg|jpeg|css|js|woff2?)$/.test(pathname);

  if (isStatic) return NextResponse.next();

  const hasCookie = request.cookies.has("auth_token");

  if (isPublic) {
    // 已登录却访问 /login → 跳首页
    if (pathname.startsWith("/login") && hasCookie) {
      return NextResponse.redirect(new URL("/", request.url));
    }
    return NextResponse.next();
  }

  // 需要认证但无 cookie → 跳 /login
  if (!hasCookie) {
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
