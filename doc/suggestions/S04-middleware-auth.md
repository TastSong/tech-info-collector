# S04: 中间件增加 token 签名验证

**关联分析**: [ANALYSIS.md](../ANALYSIS.md) → §8.1 短期改进

**优先级**: P1（重要）  
**涉及文件**: `middleware.ts`, `src/lib/password.ts`  
**预估工时**: 3h

---

## 原因

### 当前行为

```typescript
// middleware.ts:27
const hasCookie = request.cookies.has("auth_token");
```

中间件仅检查 `auth_token` cookie **是否存在**，不验证其签名。这意味着：

- 攻击者设置 `document.cookie = "auth_token=anyvalue"` 即可绕过中间件
- 中间件放行后，layout.tsx 中的 `getCurrentUser()` 会做真正的签名验证，将无效 token 返回 `null`
- 但 layout 仍渲染导航等组件，只是 `UserMenu` 组件不显示用户名

### 风险评估

- **表面安全**：虽然 layout 会做真正的 token 验证，但中间件是**第一道防线**。当前实现使 API 路由在中间件层无任何验证。
- **API 路由裸露**：`/api/crawl`、`/api/crawl/stop`、`/api/articles/[id]/view` 等路由虽然在 handler 中**没有做单独的认证检查**，但中间件仅靠 cookie 存在性就放行了。这意味着伪造的 cookie 可以触发采集动作。
- **CSRF 保护弱**：没有 CSRF token 机制。

### 设计目标

在中间件层对 `auth_token` cookie 做 HMAC 签名验证，无效 token 直接拦截。

---

## 详细修改步骤

### 步骤 1：分析制约

中间件运行在 Edge Runtime（或 Node.js Runtime），**无法直接使用 `better-sqlite3`**（native module）。但可以使用 `node:crypto` 的 HMAC。

当前 `middleware.ts` 文件头：
```typescript
// middleware.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
```

好消息是 Next.js 15 的 middleware 默认在 Node.js runtime 运行，`crypto` 可用。

### 步骤 2：中间件中实现签名验证

```typescript
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";

function getSecret(): string {
  return process.env.AUTH_SECRET ?? "dev-secret-change-me";
}

/** 在中间件中验证 token 签名（不含 DB 查询） */
function verifyTokenInMiddleware(token: string): boolean {
  try {
    const [payloadB64, sig] = token.split(".");
    if (!payloadB64 || !sig) return false;
    const expected = createHmac("sha256", getSecret()).update(payloadB64).digest("base64url");
    const sigBuf = Buffer.from(sig);
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length) return false;
    return timingSafeEqual(sigBuf, expBuf);
  } catch {
    return false;
  }
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 公开路径
  const publicPaths = ["/login", "/api/auth"];
  const isPublic = publicPaths.some(p => pathname.startsWith(p));

  // 静态资源放行
  const isStatic =
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    /\.(ico|png|svg|jpg|jpeg|css|js|woff2?)$/.test(pathname);

  if (isStatic) return NextResponse.next();

  const token = request.cookies.get("auth_token")?.value;

  if (isPublic) {
    // 已登录访问 /login → 跳首页
    if (pathname.startsWith("/login") && token && verifyTokenInMiddleware(token)) {
      return NextResponse.redirect(new URL("/", request.url));
    }
    return NextResponse.next();
  }

  // 需要认证：验证 token 有效性
  if (!token || !verifyTokenInMiddleware(token)) {
    // 清除无效 cookie
    const response = NextResponse.redirect(new URL("/login", request.url));
    response.cookies.set("auth_token", "", { maxAge: 0, path: "/" });
    return response;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
```

### 步骤 3：重构 `verifySignedToken` 避免代码重复

将共享的 HMAC 验证逻辑提取到一个不会被 Next.js 打包拒绝的位置：

```typescript
// src/lib/token-verify.ts（纯函数，不依赖 better-sqlite3）
import { createHmac, timingSafeEqual } from "node:crypto";

function getSecret(): string {
  return process.env.AUTH_SECRET ?? "dev-secret-change-me";
}

export function verifyTokenSignature(token: string): boolean {
  try {
    const [payloadB64, sig] = token.split(".");
    if (!payloadB64 || !sig) return false;
    const expected = createHmac("sha256", getSecret()).update(payloadB64).digest("base64url");
    const sigBuf = Buffer.from(sig);
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length) return false;
    return timingSafeEqual(sigBuf, expBuf);
  } catch {
    return false;
  }
}
```

然后 `password.ts` 和 `middleware.ts` 都引用此函数。

### 步骤 4：确认不能引入 DB 依赖

中间件中**一定不要导入** `db/client` 或 `db/schema`，这会导致 `better-sqlite3` 被打包到 Edge bundle 中。

用户信息的完整验证仍由 `layout.tsx` 中的 `getCurrentUser()` 处理（可访问 DB）。

### 步骤 5：验证

1. 无 cookie → 重定向 /login ✓
2. 无效 cookie（伪造签名）→ 清空 cookie + 重定向 /login
3. 有效 cookie → 正常放行
4. 已登录访问 /login → 重定向 /
5. 登录/登出流程端到端正常

---

## 影响范围

| 影响 | 说明 |
|---|---|
| 安全性 | 显著提升：中间件层即可拦截伪造 token |
| 性能 | HMAC 计算 < 1ms，对用户体验无影响 |
| 代码变化 | 中等，提取共享验证函数 |
| 兼容性 | 向后兼容，所有合法 token 仍有效 |
| DB 依赖 | 中间件不引入 DB 依赖 |
