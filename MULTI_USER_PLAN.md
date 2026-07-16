# Multi-User Implementation Plan

## 需求概述

为系统添加多用户支持，实现以下功能：

| 功能 | Admin | 普通用户 |
|------|-------|---------|
| 站点管理（CRUD、启停、分析） | ✅ | ❌ |
| 查看资讯流 | ✅ | ✅ (内容相同) |
| 文章详情 | ✅ | ✅ |
| 已读/历史记录 | ✅ | ✅ (各自隔离) |
| 收藏文章 | ✅ | ✅ (各自隔离) |
| 仪表盘 | ✅ | ✅ |
| 用户管理 | ✅ | ❌ |
| 日志查看 | ✅ | ✅ |

---

## Phase 1: 数据库 Schema 变更

### 1.1 修改 `users` 表 — 添加角色字段

```sql
ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('admin', 'user'));
```

Schema 定义变更 (`db/schema.ts`):
```ts
export const users = sqliteTable("users", {
  // ... 现有字段保持不变
  role: text("role", { enum: ["admin", "user"] }).notNull().default("user"),
});
```

### 1.2 新增 `user_article_views` 表 — 已读记录

替代 `articles.viewed_at` 全局字段，每人独立记录阅读状态。

```ts
export const userArticleViews = sqliteTable("user_article_views", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  articleId: integer("article_id")
    .notNull()
    .references(() => articles.id, { onDelete: "cascade" }),
  viewedAt: integer("viewed_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
}, (table) => [
  // 每人每篇文章仅一条已读记录
  uniqueIndex("uq_user_article_view").on(table.userId, table.articleId),
  // 按用户查询历史
  index("idx_uav_user_time").on(table.userId, table.viewedAt),
]);
```

### 1.3 新增 `user_article_saves` 表 — 收藏记录

替代 `articles.saved_at` 全局字段。

```ts
export const userArticleSaves = sqliteTable("user_article_saves", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  articleId: integer("article_id")
    .notNull()
    .references(() => articles.id, { onDelete: "cascade" }),
  savedAt: integer("saved_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
}, (table) => [
  // 每人每篇文章仅一条收藏记录（收藏/取消通过删除行实现）
  uniqueIndex("uq_user_article_save").on(table.userId, table.articleId),
]);
```

### 1.4 清理 `articles` 表

`articles.viewed_at` 和 `articles.saved_at` 变为**冗余字段**：
- 标记为 `@deprecated`，保留列但不再写入。
- 数据迁移脚本将存量数据迁入新表（Phase 5）。

---

## Phase 2: Auth 层改造

### 2.1 Token 增加 role

**文件**: `src/lib/password.ts`

```ts
interface TokenPayload {
  u: number;    // userId
  n: string;    // username
  r: string;    // role ("admin" | "user")
  i: number;    // issued at
}
```

`createSignedToken()` 签名时传入 role，`verifySignedToken()` 返回 role。

### 2.2 Auth 工具函数

**新增文件**: `src/lib/auth.ts`

```ts
import { cookies } from "next/headers";
import { verifySignedToken } from "./password";

/** 从 cookie 获取当前用户（id + username + role），未登录返回 null */
export async function getCurrentUser(): Promise<{
  id: number; username: string; role: "admin" | "user";
} | null> { ... }

/** 断言当前用户是 admin，否则返回 403 */
export async function requireAdmin(): Promise<{
  id: number; username: string; role: "admin";
}> { ... }

/** 断言已登录，否则返回 401 */
export async function requireAuth(): Promise<{
  id: number; username: string; role: "admin" | "user";
}> { ... }
```

### 2.3 中间件更新

**文件**: `middleware.ts`

当前中间件只检查 cookie 是否存在。token 解析在 layout 和各 API 中各自做。
保持当前架构不变（Edge 中间件无法访问 SQLite），但 **无需修改中间件本身**。

---

## Phase 3: 数据访问层改造

### 3.1 Feed 查询改造

**文件**: `src/data/feed.ts`

核心变更 — 所有查询需要知道当前用户的 `userId`：

| 函数 | 变更 |
|------|------|
| `countFeedArticles(userId)` | `WHERE NOT EXISTS (SELECT 1 FROM user_article_views uv WHERE uv.user_id = ? AND uv.article_id = a.id)` |
| `queryFeedArticles(opts, userId)` | 同上，JOIN user_article_views 过滤已读 |
| `countHistoryArticles(userId)` | `WHERE EXISTS (SELECT 1 FROM user_article_views uv WHERE uv.user_id = ? AND uv.article_id = a.id)` |
| `queryHistoryArticles(opts, userId)` | 同上 |
| `countSavedArticles(userId)` | `WHERE EXISTS (SELECT 1 FROM user_article_saves us WHERE us.user_id = ? AND us.article_id = a.id)` |
| `querySavedArticles(opts, userId)` | 同上 |

每个查询增加 `userId: number` 参数，所有 SQL 中的 `viewed_at IS NULL` / `saved_at IS NOT NULL` 替换为子查询 JOIN `user_article_views` / `user_article_saves`。

**具体 SQL 片段示例**（feed 未读）：
```sql
-- 原来：
WHERE a.viewed_at IS NULL AND a.status = 'published'

-- 改为：
WHERE a.status = 'published'
  AND NOT EXISTS (
    SELECT 1 FROM user_article_views uv
    WHERE uv.user_id = ? AND uv.article_id = a.id
  )
```

### 3.2 API 路由改造

| 路由 | 变更 |
|------|------|
| `GET /api/feed` | 从 cookie 获取 userId，传入 feed 查询 |
| `GET /api/history` | 同上 |
| `POST /api/articles/[id]/view` | 写入 `user_article_views` 表（INSERT OR IGNORE），不再联动 content_hash（每用户独立） |
| `POST /api/articles/view-batch` | 批量写入 `user_article_views`，每用户独立 |
| `POST /api/articles/[id]/save` | 写入/删除 `user_article_saves` 表（toggle：存在则 DELETE，不存在则 INSERT） |
| `GET/POST/PATCH/DELETE /api/sites/*` | 增加 `requireAdmin()` 检查 |
| `POST /api/sites/batch/toggle` | 同上 |
| `POST /api/sites/analyze` | 同上 |
| `POST /api/crawl` | admin only（触发采集、停止采集） |

### 3.3 页面级数据获取

| 页面 | 文件 | 变更 |
|------|------|------|
| 首页 `/` | `app/page.tsx` | 传入 userId 调用 feed 查询 |
| 历史页 `/history` | `app/history/page.tsx` | 传入 userId 调用 history 查询 |
| 文章详情 `/articles/[id]` | `app/articles/[id]/page.tsx` | 详情页本身不需要改，但进入时自动调用 `/api/articles/[id]/view` 记录阅读（当前已有此逻辑？需要确认） |

---

## Phase 4: 前端改造

### 4.1 用户 Context

**新增文件**: `app/components/AuthProvider.tsx` (可选，也可直接从 `/api/auth/me` 获取)

或者在 `layout.tsx` 中将 `currentUser`（含 role）通过 props/context 下发。当前 layout 已做 `getCurrentUser()` 验证，只需扩展返回值包含 `role`。

### 4.2 导航栏条件渲染

**文件**: `app/components/NavLinks.tsx`

需要接收 `role` 参数，非 admin 用户隐藏"站点"和"日志"导航项（或置灰显示但禁止点击）。

```tsx
// NavLinks 接受 role prop
const NAV_ITEMS = [
  { href: "/", label: "资讯流", icon: Home },
  { href: "/history", label: "历史", icon: History },
  { href: "/dashboard", label: "仪表盘", icon: LayoutDashboard },
  ...(isAdmin ? [
    { href: "/sites", label: "站点", icon: Globe },
    { href: "/runs", label: "日志", icon: FileText },
  ] : []),
];
```

### 4.3 用户管理 API

#### 4.3.1 `GET /api/admin/users` — 用户列表

```
Response 200:
{
  users: [
    { id: number, username: string, role: "admin" | "user", createdAt: number }
  ]
}
```

实现：从 `users` 表查出全部用户，按 `created_at` 排序。不返回 `password_hash`。

#### 4.3.2 `POST /api/admin/users` — 创建新用户

```
Request Body:
{
  username: string,   // 必填，2-32 字符，字母数字下划线
  password: string,   // 必填，6-128 字符
  role: "admin" | "user"  // 必填
}

Response 201: { id: number, username: string, role: string }
Response 400: { error: "用户名已存在" | "用户名格式不合法" | ... }
Response 403: { error: "无权限" }   // 非 admin 调用
```

实现细节：
- 校验 `username`：`trim()` 后长度为 2–32，正则 `/^[a-zA-Z0-9_一-鿿]+$/`（允许中英文）
- 校验 `password`：长度 6-128
- 校验 `role`：仅允许 `"admin"` 或 `"user"`
- 检查 `username` 唯一性 → 冲突返回 400
- 调用 `hashPassword()` 后 INSERT 到 `users` 表
- 返回新用户信息（不含密码）

#### 4.3.3 `DELETE /api/admin/users/[id]` — 删除用户

```
Response 200: { ok: true }
Response 400: { error: "不能删除自己" }
Response 404: { error: "用户不存在" }
```

实现细节：
- 校验 `id !== currentUser.id`（不能删除自己）
- 查询用户是否存在 → 不存在返回 404
- DELETE 用户 → `user_article_views` 和 `user_article_saves` 由 `ON DELETE CASCADE` 自动清理
- 返回 `{ ok: true }`

#### 4.3.4 路由守卫

所有 `/api/admin/*` 路由统一在 handler 开头调用 `requireAdmin()`，非 admin 直接返回 403。

#### 4.3.5 完整实现代码

**`app/api/admin/users/route.ts`**:

```ts
import { NextResponse } from "next/server";
import { db, schema } from "@/db/client";
import { requireAdmin } from "@/src/lib/auth";
import { hashPassword } from "@/src/lib/password";
import { eq, desc } from "drizzle-orm";

export const dynamic = "force-dynamic";

// GET — 用户列表
export async function GET() {
  const currentUser = await requireAdmin();
  if (!currentUser) return forbidden();

  const users = db
    .select({
      id: schema.users.id,
      username: schema.users.username,
      role: schema.users.role,
      createdAt: schema.users.createdAt,
    })
    .from(schema.users)
    .orderBy(desc(schema.users.createdAt))
    .all();

  return NextResponse.json({ users });
}

// POST — 创建用户
export async function POST(req: Request) {
  const currentUser = await requireAdmin();
  if (!currentUser) return forbidden();

  let body: { username?: string; password?: string; role?: string };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  const username = (body.username ?? "").trim();
  const password = body.password ?? "";
  const role = body.role;

  // 校验
  if (!username || username.length < 2 || username.length > 32) {
    return NextResponse.json({ error: "用户名长度需为 2-32 个字符" }, { status: 400 });
  }
  if (!/^[a-zA-Z0-9_一-鿿]+$/.test(username)) {
    return NextResponse.json({ error: "用户名只能包含中英文、数字和下划线" }, { status: 400 });
  }
  if (!password || password.length < 6 || password.length > 128) {
    return NextResponse.json({ error: "密码长度需为 6-128 个字符" }, { status: 400 });
  }
  if (role !== "admin" && role !== "user") {
    return NextResponse.json({ error: "角色必须是 admin 或 user" }, { status: 400 });
  }

  // 用户名唯一
  const existing = db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.username, username))
    .get();
  if (existing) {
    return NextResponse.json({ error: "用户名已存在" }, { status: 400 });
  }

  const passwordHash = hashPassword(password);
  const result = db
    .insert(schema.users)
    .values({ username, passwordHash: passwordHash, role: role as "admin" | "user" })
    .run();

  return NextResponse.json(
    { id: Number(result.lastInsertRowid), username, role },
    { status: 201 }
  );
}

function forbidden() {
  return NextResponse.json({ error: "无权限" }, { status: 403 });
}
```

**`app/api/admin/users/[id]/route.ts`**:

```ts
import { NextResponse } from "next/server";
import { db, schema } from "@/db/client";
import { requireAdmin } from "@/src/lib/auth";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

// DELETE — 删除用户
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const currentUser = await requireAdmin();
  if (!currentUser) {
    return NextResponse.json({ error: "无权限" }, { status: 403 });
  }

  const targetId = Number((await params).id);

  // 不能删除自己
  if (targetId === currentUser.id) {
    return NextResponse.json({ error: "不能删除自己" }, { status: 400 });
  }

  const user = db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.id, targetId))
    .get();

  if (!user) {
    return NextResponse.json({ error: "用户不存在" }, { status: 404 });
  }

  db.delete(schema.users).where(eq(schema.users.id, targetId)).run();
  return NextResponse.json({ ok: true });
}
```

---

### 4.4 用户管理页面 UI

#### 4.4.1 路由结构

```
app/admin/
├── page.tsx              # 重定向到 /admin/users（或放 admin 概览）
└── users/
    └── page.tsx          # 用户管理主页面
```

#### 4.4.2 `app/admin/users/page.tsx` 页面布局

```
┌────────────────────────────────────────────┐
│  用户管理                                   │
│  管理系统用户账户                            │
├────────────────────────────────────────────┤
│  [+ 创建用户]  (右对齐按钮)                  │
├──────┬────────┬────────┬────────┬──────────┤
│ 用户名 │ 角色   │ 创建时间 │ 操作   │        │
├──────┼────────┼────────┼────────┼──────────┤
│ wang │ admin  │ 07-16  │ [删除] │        │
│ bob  │ user   │ 07-20  │ [删除] │        │
│ ...  │ ...    │ ...    │ [删除] │        │
└──────┴────────┴────────┴────────┴──────────┘
```

#### 4.4.3 交互细节

**创建用户弹窗** (Modal / Dialog):

```
┌─────────────────────────────────┐
│  创建新用户                      │
│                                 │
│  用户名  [_______________]      │
│  密码    [_______________]      │
│  角色    [admin ▼]             │
│                                 │
│  错误提示区域（用户名已存在等）    │
│                                 │
│  [取消]           [确认创建]     │
└─────────────────────────────────┘
```

- 点击 "创建用户" 按钮 → 打开 Modal
- 填写用户名、密码、选择角色
- 提交 → POST `/api/admin/users`
- 成功 → 关闭弹窗，刷新用户列表，Toast 提示 "已创建用户 xxx"
- 失败 → 弹窗内显示错误信息，不关闭

**删除用户**:
- 每行操作列有 "删除" 按钮
- 点击 → 弹出确认对话框："确定要删除用户 xxx 吗？其已读记录和收藏将一并清除。"
- 当前登录用户自己的行不显示删除按钮（灰色文字提示 "当前用户"）
- 确认 → DELETE `/api/admin/users/[id]`
- 成功 → 列表移除该行，Toast 提示 "已删除"

**页面级路由保护**:
- `app/admin/layout.tsx` 检查 role，非 admin → redirect("/")
- 或直接在 `app/admin/users/page.tsx` 开头调用 `requireAdmin()`

---

### 4.5 导航栏改造

#### 4.5.1 NavLinks 增加 "管理" 入口

**文件**: `app/components/NavLinks.tsx`

接收 `role` prop。admin 用户在导航最后追加 "管理" 链接：

```tsx
// 原有导航项
const BASE_ITEMS = [
  { href: "/", label: "资讯流", icon: Home },
  { href: "/history", label: "历史", icon: History },
  { href: "/dashboard", label: "仪表盘", icon: LayoutDashboard },
];

// admin 专属项
const ADMIN_ITEMS = [
  { href: "/sites", label: "站点", icon: Globe },
  { href: "/runs", label: "日志", icon: FileText },
  { href: "/admin/users", label: "管理", icon: Users },
];
```

非 admin 看不到站点、日志、管理三个导航项。

#### 4.5.2 layout.tsx 变更

```tsx
// app/layout.tsx
const currentUser = await getCurrentUser();  // 现在返回 { id, username, role }

// 传递 role 到 NavLinks
<NavLinks role={currentUser?.role} />
```

---

### 4.6 路由保护

| 路由 | 保护级别 | 实现方式 |
|------|---------|---------|
| `/login` | 公开（已登录则跳到 /） | middleware 处理 |
| `/`, `/feed`, `/history`, `/dashboard` | 需登录 | middleware 检查 cookie |
| `/articles/*` | 需登录 | middleware |
| `/sites/*` | admin only | 页面 server component 检查 role |
| `/runs` | admin only | 页面 server component 检查 role |
| `/admin/*` | admin only | `app/admin/layout.tsx` 统一检查 |

**`app/admin/layout.tsx`**:

```tsx
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/src/lib/auth";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    redirect("/");
  }
  return <>{children}</>;
}
```

---

## Phase 5: 数据迁移

### 5.1 迁移脚本

**新增文件**: `scripts/migrate-to-multi-user.ts`

```ts
// 执行步骤：
// 1. 为现有 users 设置 role = 'admin'
// 2. 将 articles.viewed_at 迁移到 user_article_views（关联到唯一 admin 用户）
// 3. 将 articles.saved_at 迁移到 user_article_saves（关联到唯一 admin 用户）
// 4. （可选）保留 articles 中的字段不做删除，仅标记 deprecated
```

### 5.2 运行方式

```bash
docker compose exec app tsx scripts/migrate-to-multi-user.ts
```

迁移前建议备份 `data/collector.db`。

---

## Phase 6: 各端交互细节

### 6.1 已读联动

**当前行为**: 标记一篇文章已读 → 联动标记同 `content_hash` 的其他文章为已读（全局）。

**多用户行为**: 保持不变但限定在当前用户的范围内：
- 用户 A 标记某文章已读 → 对用户 A，同 `content_hash` 的其他文章也标记已读
- 用户 B 不受影响

实现：在 `POST /api/articles/[id]/view` 中，查到 content_hash 后，对**当前用户的** `user_article_views` 表中同 hash 的文章也插入记录。

### 6.2 收藏

- 收藏切换：`user_article_saves` 中 toggle（存在则 DELETE，不存在则 INSERT）
- 反应到 feed 结果：`savedAt` 字段从 `user_article_saves.saved_at` JOIN 获取
- 移动端右滑收藏：保持不变

### 6.3 历史记录

- 按当前用户的 `user_article_views.viewed_at` DESC 排序
- 去重逻辑不变

---

## 改动文件清单

```
# 数据库
db/schema.ts                          # +role 列, +user_article_views, +user_article_saves
db/client.ts                          # +建表 DDL

# Auth
src/lib/password.ts                   # token 增加 role
src/lib/auth.ts                       # [NEW] getCurrentUser, requireAdmin, requireAuth

# 数据访问层
src/data/feed.ts                      # 所有查询增加 userId 参数

# 中间件
middleware.ts                         # 无需修改（只检查 cookie 存在性）

# API 路由
app/api/auth/login/route.ts           # token 签名增加 role
app/api/auth/me/route.ts              # 返回 role
app/api/feed/route.ts                 # 传入 userId
app/api/history/route.ts              # 传入 userId
app/api/articles/[id]/view/route.ts   # 写入 user_article_views
app/api/articles/[id]/save/route.ts   # 写入/删除 user_article_saves
app/api/articles/view-batch/route.ts  # 批量写入 user_article_views
app/api/sites/route.ts                # +requireAdmin
app/api/sites/[id]/route.ts           # +requireAdmin
app/api/sites/[id]/toggle/route.ts    # +requireAdmin
app/api/sites/batch/toggle/route.ts   # +requireAdmin
app/api/sites/analyze/route.ts        # +requireAdmin
app/api/crawl/route.ts                # +requireAdmin
app/api/admin/users/route.ts          # [NEW] GET 列表 + POST 创建
app/api/admin/users/[id]/route.ts     # [NEW] DELETE 删除用户

# 页面
app/layout.tsx                        # 传递 user role 到 NavLinks
app/admin/layout.tsx                  # [NEW] admin 路由守卫（非 admin 重定向 /）
app/admin/users/page.tsx              # [NEW] 用户管理页面（列表 + 创建弹窗 + 删除）
app/page.tsx                          # 传入 userId 到 feed 查询
app/history/page.tsx                  # 传入 userId 到 history 查询
app/components/NavLinks.tsx           # 接收 role prop，条件渲染导航项
app/components/UserMenu.tsx           # 可能增加"管理"快捷入口

# 迁移
scripts/migrate-to-multi-user.ts      # [NEW] 存量数据迁移脚本

# 初始化
src/lib/init-user.ts                  # 初始 admin 用户 role='admin'

---

## 实施建议

1. **按 Phase 顺序执行**，每个 Phase 可独立提交。
2. **先做 Phase 2 (Auth) + Phase 1 的 role 字段**，确保 token 中包含 role 后再改 API。
3. **Phase 3 是核心工作**，涉及 feed 查询重写和所有 API 改造。
4. **Phase 5 迁移脚本**在部署前执行，建议先在备份数据上测试。
5. **安全要点**：所有 admin API 必须双重校验 — middleware 检查登录 + requireAdmin() 检查 role。
