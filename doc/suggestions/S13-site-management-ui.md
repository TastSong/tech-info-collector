# S13: 站点配置管理 UI

**关联分析**: [ANALYSIS.md](../ANALYSIS.md) → §8.2 中期改进

**优先级**: M5  
**涉及文件**: 新建 `app/sites/[id]/page.tsx`, `app/api/sites/[id]/route.ts`, 修改 `app/sites/page.tsx`  
**预估工时**: 12h

---

## 原因

### 当前行为

当前站点配置完全由编辑 `sites.json`（1500+ 行 JSON）然后通过 seed/init 脚本导入数据库来管理。选择器通过命令行工具（`discover-selectors.ts` 等）发现并写 DB。

这导致：
- **非技术人员无法管理**：修改配置需要编辑 JSON 并重启
- **容易出错**：JSON 格式错误会导致初始化脚本异常
- **数据漂移**：DB 和 JSON 文件不同步（需手动运行 sync 脚本）
- **缺少验证**：无前端表单校验

### 设计目标

为站点配置提供 Web 管理界面：查看、编辑、启用/禁用、探测选择器。

---

## 详细修改步骤

### 步骤 1：创建站点详情编辑页面

新建 `app/sites/[id]/page.tsx`：

```typescript
// 该页面为 SSR + "use client" 编辑表单
// 支持编辑站点的：
// - name, category, subcategory
// - urls (多个 URL)
// - render (static/dynamic)
// - CSS 选择器
// - aiInvolvement
// - scope
// - interval
// - enabled
```

核心组件结构：
```tsx
export default function SiteEditPage({ params }: { params: Promise<{ id: string }> }) {
  // SSR 加载站点数据
  // Client 表单提供编辑和保存功能
  return (
    <main>
      <h1>编辑站点</h1>
      <SiteEditForm site={site} />
      <SelectorDiscoverPanel siteId={site.id} />
    </main>
  );
}
```

### 步骤 2：创建 API 端点

新建 `app/api/sites/[id]/route.ts`：

```typescript
import { NextResponse } from "next/server";
import { db, schema } from "@/db/client";
import { eq } from "drizzle-orm";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const site = db.select().from(schema.sites).where(eq(schema.sites.id, Number(id))).get();
  if (!site) return NextResponse.json({ error: "站点不存在" }, { status: 404 });
  return NextResponse.json(site);
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  
  // 校验必填字段
  if (body.name && !body.name.trim()) {
    return NextResponse.json({ error: "名称不能为空" }, { status: 400 });
  }
  
  const site = db.select().from(schema.sites).where(eq(schema.sites.id, Number(id))).get();
  if (!site) return NextResponse.json({ error: "站点不存在" }, { status: 404 });
  
  db.update(schema.sites)
    .set({
      ...body,
      // 确保 urls 是 JSON 格式
      urls: body.urls ? body.urls : undefined,
    })
    .where(eq(schema.sites.id, Number(id)))
    .run();
  
  const updated = db.select().from(schema.sites).where(eq(schema.sites.id, Number(id))).get();
  return NextResponse.json(updated);
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  // 删除前检查是否有文章关联
  const articleCount = db.select({ c: sql`count(*)` })
    .from(schema.articles)
    .where(eq(schema.articles.siteId, Number(id)))
    .all();
  
  if (articleCount[0]?.c > 0) {
    return NextResponse.json(
      { error: `该站点有 ${articleCount[0].c} 篇文章，请先清理后再删除` },
      { status: 409 }
    );
  }
  
  db.delete(schema.sites).where(eq(schema.sites.id, Number(id))).run();
  return NextResponse.json({ ok: true });
}
```

### 步骤 3：创建站点列表的后台操作

新建 `app/api/sites/route.ts`：

```typescript
export async function POST(req: Request) {
  const body = await req.json();
  // 创建新站点
  const result = db.insert(schema.sites).values({
    name: body.name,
    category: body.category,
    urls: body.urls ?? [],
    render: body.render ?? "static",
    aiInvolvement: body.aiInvolvement ?? "extract_judge",
    enabled: body.enabled ?? false,
    scope: body.scope,
  }).run();
  
  return NextResponse.json({ id: result.lastInsertRowid }, { status: 201 });
}
```

### 步骤 4：选择器探测按钮

在站点编辑页面添加"探测选择器"按钮，调用服务端逻辑：

```typescript
// app/api/sites/[id]/probe/route.ts
export async function POST(req: Request, { params }: ...) {
  const site = await getSite(...);
  const html = await fetchHtml(site.urls[0], site.render);
  const selectors = discoverSelectors(html, site.urls[0]);
  return NextResponse.json({ candidates: selectors });
}
```

### 步骤 5：将 sites.json 改为 DB-only

逐步废弃 `sites.json` 作为配置源：

1. 所有新站点的配置通过 Web UI 管理
2. `sites.json` 仅作为初始导入的参考
3. 添加 `POST /api/sites/export` 导出 API（用于备份）
4. 移除 `init-db.cjs` 中的 sites.json 导入逻辑

### 步骤 6：验证

1. 站点列表页 (`/sites`) 每个站点显示"编辑"按钮
2. 点击编辑 → 表单可修改所有字段
3. 保存 → DB 更新，页面刷新
4. 删除 → 提示确认
5. 新建站点 → 表单可创建

---

## 影响范围

| 影响 | 说明 |
|---|---|
| 用户体验 | 从"编辑 JSON"变为"Web 表单操作" |
| 数据一致性 | DB 是唯一数据源，消除 JSON/DB 漂移 |
| 新 API | 5 个新端点 |
| 安全 | 所有变更 API 需要认证 |
