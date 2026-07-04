# S07: 添加登录速率限制

**关联分析**: [ANALYSIS.md](../ANALYSIS.md) → §8.1 短期改进

**优先级**: P2（中等）  
**涉及文件**: `app/api/auth/login/route.ts`, `middleware.ts`  
**预估工时**: 2h

---

## 原因

### 当前行为

```typescript
// app/api/auth/login/route.ts
export async function POST(req: Request) {
  // ... 解析 username/password
  // 无任何速率限制
  const user = db.select()...where(eq(schema.users.username, username)).get();
  // ...
}
```

任何人都可以无限次地尝试登录。结合 S04 中提到的中间件问题（仅检查 cookie 存在性），暴力攻击者可以：
1. 高频调用 `/api/auth/login` 尝试猜测密码
2. 成功后伪造任意 token 获取中间件放行

### 风险评估

- 数据库中仅有一个用户，密码是 `AUTH_SECRET` + `scrypt` 哈希——b crypt 级别安全性
- 但没有速率限制，攻击者可以无限次尝试
- 如果 `AUTH_SECRET` 使用默认值 `dev-secret-change-me`，token 签名可被伪造

### 设计目标

使用内存计数器实现简单的速率限制：同一 IP 在 1 分钟内最多 5 次登录尝试，失败后等待 1 分钟冷却。

---

## 详细修改步骤

### 步骤 1：创建内存速率限制器

新建 `src/lib/rate-limit.ts`：

```typescript
interface Bucket {
  count: number;
  resetAt: number;
}

const store = new Map<string, Bucket>();

// 每 10 分钟清理一次过期条目
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of store) {
    if (now > bucket.resetAt) store.delete(key);
  }
}, 10 * 60 * 1000).unref();

/**
 * 简单速率限制检查
 * @returns true = 允许请求，false = 超过限制
 */
export function checkRateLimit(
  key: string,
  maxRequests: number = 5,
  windowMs: number = 60_000
): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const bucket = store.get(key);

  if (!bucket || now > bucket.resetAt) {
    // 新建或重置窗口
    const newBucket: Bucket = { count: 1, resetAt: now + windowMs };
    store.set(key, newBucket);
    return { allowed: true, remaining: maxRequests - 1, resetAt: newBucket.resetAt };
  }

  bucket.count++;
  if (bucket.count > maxRequests) {
    return { allowed: false, remaining: 0, resetAt: bucket.resetAt };
  }

  return { allowed: true, remaining: maxRequests - bucket.count, resetAt: bucket.resetAt };
}
```

### 步骤 2：在登录路由中使用

```typescript
// app/api/auth/login/route.ts
import { checkRateLimit } from "@/src/lib/rate-limit";

export async function POST(req: Request) {
  // 获取客户端 IP
  const forwarded = req.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() ?? "unknown";
  const rateLimitKey = `login:${ip}`;

  // 速率限制检查
  const limit = checkRateLimit(rateLimitKey, 5, 60_000);
  if (!limit.allowed) {
    return NextResponse.json(
      {
        error: `登录尝试过于频繁，请 ${Math.ceil((limit.resetAt - Date.now()) / 1000)} 秒后重试`,
        retryAfter: Math.ceil((limit.resetAt - Date.now()) / 1000),
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil((limit.resetAt - Date.now()) / 1000)),
          "X-RateLimit-Remaining": "0",
        },
      }
    );
  }

  // 添加速率限制头到响应
  const response = NextResponse.json({ ok: true, username: user.username });
  response.headers.set("X-RateLimit-Remaining", String(limit.remaining));
  return response;
}
```

### 步骤 3：中间件层全局速率限制（可选）

对于 API 路由，可以在中间件中添加更粗粒度的限制：

```typescript
// middleware.ts 中添加（仅对 /api/ 路径）
if (pathname.startsWith("/api/")) {
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() ?? "unknown";
  const limit = checkRateLimit(`api:${ip}`, 100, 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too Many Requests" }, { status: 429 });
  }
}
```

### 步骤 4：验证

1. 正常登录不受影响
2. 连续 5 次登录失败后，第 6 次返回 429
3. 等待 60 秒窗口重置后可重新尝试
4. Docker 反向代理场景下 `x-forwarded-for` 正确提取

### 局限性

- **不是分布式的**：内存计数器，进程重启后丢失，多副本不共享
- **不防分布式攻击**：攻击者用多个 IP 仍可绕过
- 对于 MVP 阶段的单副本部署，足以防止简单的暴力破解

---

## 影响范围

| 影响 | 说明 |
|---|---|
| 安全性 | 显著提升：阻止基本暴力破解 |
| 内存消耗 | ~几百 bytes（仅存储活跃 IP） |
| 分布式 | 不适于多副本部署（需要 Redis 替代） |
| 用户体验 | 正常用户不受影响（5次/分钟足够） |
