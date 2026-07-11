# 科技情报采集器 — 用户体验 (UX) 改进建议

> 面向提升交互体验，涵盖动画、图标、交互反馈、无障碍、移动端等方面的具体修改建议。
>
> 分析日期：2026-07-11

---

## 目录

1. [全局性改进](#1-全局性改进)
2. [导航栏 (NavLinks + UserMenu)](#2-导航栏-navlinks--usermenu)
3. [资讯流首页 (FeedList + FeedCard)](#3-资讯流首页-feedlist--feedcard)
4. [仪表盘 (Dashboard)](#4-仪表盘-dashboard)
5. [文章详情页 (Article Detail)](#5-文章详情页-article-detail)
6. [文章流 (Articles Page)](#6-文章流-articles-page)
7. [已读历史 (History Page)](#7-已读历史-history-page)
8. [运行日志 (Runs Page)](#8-运行日志-runs-page)
9. [站点管理 (Sites Pages)](#9-站点管理-sites-pages)
10. [登录页 (Login Page)](#10-登录页-login-page)
11. [全局 CSS 与动画系统](#11-全局-css-与动画系统)
12. [优先级排序与实施路线](#12-优先级排序与实施路线)

---

## 1. 全局性改进

### 1.1 引入图标库（P0 · 高优先级）

**现状**：全站使用 Unicode emoji（🤖 ★ ☆ ✓ ✗）和少量内联 SVG 作为图标，视觉风格不统一，渲染效果因平台差异大（如 Windows 上 emoji 通常是黑白线条）。

**建议**：引入 `lucide-react` 图标库（零依赖、tree-shakable、React 原生支持）。

```bash
pnpm add lucide-react
```

**具体替换清单**：

| 当前位置 | 当前实现 | 建议替换为 |
|----------|----------|------------|
| AI 摘要标题 `🤖` | emoji | `<Bot className="h-5 w-5 text-indigo-500" />` |
| 日期桶标题 `📅` | emoji | `<Calendar className="h-4 w-4" />` |
| 收藏按钮 ★ ☆ | unicode | `<Star className="h-5 w-5" fill="..." />` / `<StarOff />` |
| 全选/状态 ✗ ✓ ⊗ | unicode | `<Check />` / `<X />` / `<Loader />` |
| "已阅读" 按钮 | 纯文本 | `<Eye className="h-3.5 w-3.5" />` + 文字 |
| "已发布/已驳回" badge | unicode | `<CheckCircle2 />` / `<XCircle />` |
| 时钟图标（定时采集） | 内联 SVG | `<Clock className="h-5 w-5 text-indigo-500" />` |
| 导航链接 | 纯文字 | 可选：`<Home />`, `<History />`, `<LayoutDashboard />`, `<Globe />`, `<FileText />` |
| 已读标记 ✓ | unicode | `<CheckCheck />` |
| 错误/警告 ✗ | unicode | `<AlertTriangle />` / `<AlertCircle />` |
| 首页/末页导航 | 纯文字 | `<ChevronsLeft />` / `<ChevronsRight />` |
| 上一页/下一页 | 纯文字 | `<ChevronLeft />` / `<ChevronRight />` |
| 搜索输入框 | 无 | 在搜索框左侧加 `<Search className="h-4 w-4 text-slate-400" />` |
| 空状态 | 纯文字 | `<Inbox className="h-12 w-12 text-slate-300" />` |
| 外部链接 | 无 | `<ExternalLink className="h-3 w-3" />` |
| 刷新 | 无 | `<RefreshCw className="h-4 w-4" />` |
| 清除筛选 ✕ | unicode | `<X />` |
| 添加 + | 字符 | `<Plus className="h-4 w-4" />` |
| 删除 | 纯文字 | `<Trash2 className="h-4 w-4" />` |
| 调度/时钟 | 内联 SVG | `<Clock />` |
| 筛选/漏斗 | 无 | `<Filter />` |

---

### 1.2 Toast 通知系统（P0 · 高优先级）

**现状**：操作反馈（如采集启动、保存成功、标记已读）使用内联消息文字（如 `msg` state 变量），或在页面中嵌入 `div` 展示成功/错误。缺少统一的、非阻塞的通知机制。

**建议**：实现一个轻量级 Toast 通知系统。

**实现位置**：新建 `app/components/Toast.tsx` + `app/components/ToastProvider.tsx`，在 `layout.tsx` 中挂载。

**功能要求**：
- 支持 `success` / `error` / `info` / `warning` 四种类型
- 自动消失（3-5秒），可手动关闭
- 从右上角滑入 (slide-in-right 动画)
- 堆叠显示（最多 3 条同时可见）
- 通过 Context 暴露 `toast.success(msg)`, `toast.error(msg)` 方法

**需要在以下位置接入**：
- `CrawlTrigger`: 采集启动/停止 → toast.success/toast.info
- `SiteEditForm`: 保存成功/失败 → toast.success/toast.error
- `FeedList`: 全部已读 → toast.success
- `FeedCard`: 收藏切换/已读标记 → toast.success
- `SitesList`: 批量操作 → toast.success

---

### 1.3 键盘快捷键支持（P2 · 低优先级）

**现状**：纯鼠标/触控操作，无键盘快捷键。

**建议**：添加全局键盘快捷键：

| 快捷键 | 功能 |
|--------|------|
| `Ctrl+K` / `Cmd+K` | 命令面板（快速导航+搜索） |
| `j` / `k` | 在 feed 列表中上下移动焦点 |
| `Enter` | 打开当前聚焦的文章 |
| `s` | 收藏/取消收藏当前聚焦文章 |
| `m` | 标记已读当前聚焦文章 |
| `Esc` | 关闭弹窗/模态框 |
| `g d` | 前往仪表盘 |
| `g f` | 前往资讯流 |
| `g s` | 前往站点管理 |

---

### 1.4 暗色模式（P2 · 低优先级）

**现状**：仅支持亮色主题，硬编码 `bg-slate-50` / `text-slate-900` 等颜色。

**建议**：利用 Tailwind CSS 4 的 `dark:` 前缀支持暗色模式（需在 CSS 中配置 `@variant dark (&:where(.dark, .dark *))`）。

**实现路径**：
1. 在 `<html>` 上添加 `class="dark"` 切换
2. 在 `UserMenu` 或导航栏添加主题切换按钮 `<Sun />` / `<Moon />`
3. 使用 `localStorage` 持久化偏好
4. 优先处理：导航栏、卡片列表、表格 → 表单 → 详情页

**关键色板映射**：

| 组件 | 亮色 | 暗色替代 |
|------|------|----------|
| 页面背景 | `bg-slate-50` | `dark:bg-slate-900` |
| 卡片 | `bg-white border-slate-200` | `dark:bg-slate-800 dark:border-slate-700` |
| 标题文字 | `text-slate-900` | `dark:text-slate-100` |
| 正文 | `text-slate-700` | `dark:text-slate-300` |
| 辅助文字 | `text-slate-500` | `dark:text-slate-400` |
| 表格表头 | `bg-slate-50` | `dark:bg-slate-800` |

---

## 2. 导航栏 (NavLinks + UserMenu)

### 2.1 当前路由高亮（P0 · 高优先级）

**现状** (`NavLinks.tsx`): 导航链接无当前路由高亮，用户无法一目了然地知道自己在哪里。

**建议**：使用 `usePathname()` 检测当前路由，为激活的链接添加背景高亮：

```tsx
// NavLink 内部
const pathname = usePathname();
const isActive = pathname === href || (href !== "/" && pathname.startsWith(href));

className={`... ${isActive
  ? "bg-indigo-50 text-indigo-700 font-semibold"
  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
}`}
```

### 2.2 活跃路由指示器动画（P1 · 中优先级）

在激活链接下方添加一个微小的滑动指示条：

```tsx
{isActive && (
  <motion.span
    layoutId="nav-indicator"
    className="absolute bottom-0 left-1/2 h-0.5 w-4 -translate-x-1/2 rounded-full bg-indigo-500"
  />
)}
```

需要使用 `framer-motion` 或手动 CSS transition。

### 2.3 移动端下拉菜单动画（P1 · 中优先级）

**现状**：移动端菜单是 `{open && <div>...}` 的硬切换，无过渡动画。

**建议**：使用 CSS `max-height` 过渡或 `framer-motion` 的 `AnimatePresence`：

```tsx
// 纯 CSS 方案（更轻量）
<div className={`overflow-hidden transition-all duration-300 ease-in-out ${
  open ? "max-h-80 opacity-100" : "max-h-0 opacity-0"
}`}>
```

### 2.4 退出按钮增加确认（P2 · 低优先级）

**现状** (`UserMenu.tsx`): 点击"退出"直接执行登出，无二次确认。

**建议**：增加确认对话框或 Popover：

```
[当前：点击退出 → 直接登出]
[建议：点击退出 → "确定退出登录？" Popover → 确认 → 登出]
```

### 2.5 用户头像/图标（P2 · 低优先级）

**现状**：用户名 + "退出" 纯文字。

**建议**：在用户名左侧添加 `<UserCircle className="h-5 w-5 text-slate-400" />` 图标，提升可辨识度。

---

## 3. 资讯流首页 (FeedList + FeedCard)

### 3.1 搜索防抖 (Debounce)（P0 · 高优先级）

**现状** (`FeedList.tsx`): 搜索输入 `onChange` 即时触发筛选，虽为客户端过滤，但每次按键都重建 `bucketInfos` 的 `useMemo`。

**建议**：添加 300ms 防抖：

```tsx
const [search, setSearch] = useState("");
const [debouncedSearch, setDebouncedSearch] = useState("");
// useEffect: delay 300ms before updating debouncedSearch
// 用 debouncedSearch 参与 filtered useMemo
```

### 3.2 卡片入场动画（P0 · 高优先级）

**现状**：文章列表无入场动画，初次加载或翻页时所有卡片同时出现。

**建议**：使用 CSS `@keyframes` 实现交错入场（staggered entrance）：

```css
@keyframes slideUpFade {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}

.feed-card-enter {
  animation: slideUpFade 0.3s ease-out both;
}
```

为每个卡片设置递增的 `animation-delay`（`index * 50ms`，最多延迟 500ms）。

### 3.3 "标记已读"按钮的即时视觉反馈（P0 · 高优先级）

**现状**：点击"已阅读"按钮后，state 变为 `loading → dismissing → dismissed`（300ms 后），但 `loading` 阶段只是显示 `...`。

**建议**：
- `loading` 状态显示 `<Loader className="animate-spin h-3 w-3" />` 旋转动画
- `dismissing` 状态使用现有的 opacity + translateY + blur 过渡（目前已有，效果不错）
- 成功后加入轻微的"弹跳"缩放效果

### 3.4 "全部已读"按钮增加进度动画（P1 · 中优先级）

**现状**：点击"全部已读"后显示"处理中…"，无进度感知。

**建议**：分数批发送请求（每 10 条一批），用进度条展示：

```tsx
// 伪代码
const BATCH_SIZE = 10;
let done = 0;
for (let i = 0; i < ids.length; i += BATCH_SIZE) {
  const batch = ids.slice(i, i + BATCH_SIZE);
  await fetch("/api/articles/view-batch", { ... });
  done += batch.length;
  setProgress(Math.round((done / ids.length) * 100));
}
```

并在按钮旁显示 "正在标记 15/50…" 的进度文字。

### 3.5 空状态插图（P1 · 中优先级）

**现状** (`FeedList.tsx`): 空状态仅显示文字 "暂无新资讯 ✓" / "没有匹配的文章"。

**建议**：替换为带图标的空状态组件：

```tsx
// 无文章时
<div className="flex flex-col items-center py-16">
  <Inbox className="h-16 w-16 text-slate-200 mb-4" />
  <p className="text-slate-400 font-medium">暂无新资讯</p>
  <p className="text-sm text-slate-300 mt-1">所有文章已读完，干得漂亮 🎉</p>
</div>

// 筛选无结果时
<div className="flex flex-col items-center py-16">
  <SearchX className="h-16 w-16 text-slate-200 mb-4" />
  <p className="text-slate-400 font-medium">没有匹配的文章</p>
  <p className="text-sm text-slate-300 mt-1">试试调整筛选条件</p>
  <button onClick={clearFilters} className="...">清除筛选</button>
</div>
```

### 3.6 收藏按钮动画增强（P1 · 中优先级）

**现状** (`FeedCard.tsx`): 收藏按钮切换时无动画（仅颜色变化 + `animate-pulse`）。

**建议**：
- 点击时增大 1.2 倍再弹回（scale bounce）
- 收藏成功时短暂显示黄色光晕（ring glow）

```css
@keyframes starPop {
  0% { transform: scale(1); }
  50% { transform: scale(1.4); }
  100% { transform: scale(1); }
}

.star-pop {
  animation: starPop 0.3s ease-out;
}
```

### 3.7 分类标题折叠/展开（P1 · 中优先级）

**现状**：日期桶内的分类分组始终展开，当日文章较多时页面很长。

**建议**：为每个分类分组添加可折叠支持（默认展开）。使用 `<details>` / `<summary>` 或 `useState` 控制。

### 3.8 滑动删除手势增强（P2 · 低优先级）

**现状** (`FeedCard.tsx`): 移动端已支持左滑已读、右滑收藏，实现质量不错。但缺少触觉反馈（haptic feedback）。

**建议**：
- 滑动超过阈值时触发 `navigator.vibrate(10)`（触觉反馈）
- 成功完成操作后回弹动画更平滑（使用 `transition-timing-function: spring` 或 ease-out-back）

### 3.9 "加载更多"替代传统分页（P2 · 低优先级）

**现状**：资讯流使用传统分页（首页/上一页/页码/下一页/末页），移动端体验一般。

**建议**：增加无限滚动选项（可选），使用 `IntersectionObserver`：
- 保留现有分页作为桌面端选项
- 移动端默认使用 "加载更多" 按钮或自动加载

---

## 4. 仪表盘 (Dashboard)

### 4.1 统计卡片数字滚动动画（P1 · 中优先级）

**现状** (`Dashboard`): 统计数字（总文章/已发布/已驳回）静态展示。

**建议**：页面首次加载时数字从 0 递增到目标值（count-up 效果）：

```tsx
// 简易版：用 useState + useEffect + requestAnimationFrame
function AnimatedNumber({ value, duration = 800 }: { value: number; duration?: number }) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    let start: number;
    const step = (ts: number) => {
      if (!start) start = ts;
      const progress = Math.min((ts - start) / duration, 1);
      setDisplay(Math.floor(progress * value));
      if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, [value, duration]);
  return <>{display.toLocaleString()}</>;
}
```

### 4.2 站点概况表格的"空行"提示（P1 · 中优先级）

**现状**：站点概况表格无空状态提示。

**建议**：0 篇时显示 `—` 或淡色文字，而不是 `0`。

### 4.3 最近采集状态的颜色编码（P1 · 中优先级）

**现状**：表格行已有 hover 高亮，但不同状态的背景色区分不够明显。

**建议**：
- 运行中的 session 行使用浅蓝色 (`bg-indigo-50/50`)
- 失败的 session 行使用浅红色 (`bg-red-50/30`)
- 必要时在表格左侧添加 3px 的竖色条

### 4.4 实时进度条动画增强（P2 · 低优先级）

**现状** (`LiveProgress.tsx`): 进度条使用 `transition-all duration-500`，但宽度变化时不够流畅。

**建议**：
- 进度条添加微弱的发光/扫光效果（shimmer animation）
- 使用 `transition: width 0.8s cubic-bezier(0.4, 0, 0.2, 1)` 实现更自然的缓动

```css
@keyframes shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}

.progress-shimmer {
  background: linear-gradient(90deg, #6366f1 25%, #818cf8 50%, #6366f1 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
}
```

### 4.5 定时采集设置的快捷操作（P2 · 低优先级）

**现状** (`ScheduleSection.tsx`): 需要点击"修改"按钮打开模态框来调整调度。

**建议**：在 ScheduleSection 卡片上增加快速切换按钮：
- "立即暂停定时采集" / "恢复定时采集"
- 显示"下一次采集时间"

---

## 5. 文章详情页 (Article Detail)

### 5.1 阅读进度条（P0 · 高优先级）

**现状** (`articles/[id]/page.tsx`): 长文章无阅读位置指示。

**建议**：页面顶部添加阅读进度条（细线，随滚动填充）：

```tsx
"use client";
function ReadingProgress() {
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    const onScroll = () => {
      const scrollTop = window.scrollY;
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      setProgress(docHeight > 0 ? scrollTop / docHeight : 0);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return (
    <div className="fixed top-0 left-0 z-50 h-1 bg-gradient-to-r from-indigo-400 to-purple-400 transition-[width] duration-150"
         style={{ width: `${Math.round(progress * 100)}%` }} />
  );
}
```

### 5.2 返回顶部按钮（P1 · 中优先级）

**现状**：长文章需手动滚回顶部。

**建议**：右下角浮动"返回顶部"按钮，滚动超过一屏后显示：

```tsx
{showScrollTop && (
  <button
    onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
    className="fixed bottom-6 right-6 z-40 h-10 w-10 rounded-full bg-indigo-600 text-white shadow-lg hover:bg-indigo-700 transition-all hover:scale-110"
  >
    <ArrowUp className="h-5 w-5 mx-auto" />
  </button>
)}
```

### 5.3 审核指标可视化增强（P1 · 中优先级）

**现状** (`articles/[id]/page.tsx`): 审核指标以纯文字展示（"✓ 相关"、"✗ 无关"等），缺少视觉比重。

**建议**：
- 质量分 (qualityScore) 用 5 星评分或环形进度条展示
- 新闻属性评分用颜色渐变的进度条展示
- 相关性和可用性用绿色 ✓ / 红色 ✗ 的 pill badge（现有，但不够显眼）

```tsx
// 环形进度条用于 qualityScore
function ScoreRing({ score, size = 60 }: { score: number; size?: number }) {
  const radius = (size - 4) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - score);
  const color = score >= 0.7 ? "text-emerald-500" : score >= 0.4 ? "text-amber-500" : "text-red-500";
  return (
    <svg width={size} height={size} className="-rotate-90">
      <circle cx={size/2} cy={size/2} r={radius} fill="none" stroke="currentColor"
              className="text-slate-200" strokeWidth="3" />
      <circle cx={size/2} cy={size/2} r={radius} fill="none"
              stroke="currentColor" strokeWidth="3" strokeLinecap="round"
              className={`${color} transition-all duration-1000`}
              strokeDasharray={circumference} strokeDashoffset={offset} />
      <text x={size/2} y={size/2+1} textAnchor="middle" dominantBaseline="middle"
            className="fill-slate-700 text-xs font-bold" style={{ transform: "rotate(90deg)", transformOrigin: "center" }}>
        {Math.round(score * 100)}
      </text>
    </svg>
  );
}
```

### 5.4 面包屑导航（P2 · 低优先级）

**现状**：文章详情页仅有一个"← 返回资讯流"链接。

**建议**：增加面包屑导航：
```
资讯流 > [站点名] > [文章标题]
```

### 5.5 分享/复制链接按钮（P2 · 低优先级）

**现状**：无法复制文章链接或分享。

**建议**：在标题旁增加"复制链接"按钮，点击复制当前 URL 到剪贴板，并显示 "已复制 ✓" 提示。

---

## 6. 文章流 (Articles Page)

### 6.1 状态筛选标签增强（P1 · 中优先级）

**现状** (`articles/page.tsx`): 筛选按钮是圆形 pill，状态切换时是`bg-slate-800` 高亮。

**建议**：
- 每个状态标签添加对应颜色的指示点
- 选中状态添加平滑的 `scale` 过渡动画
- 显示各状态数量：`已发布 (42)`、`已驳回 (13)` 等

### 6.2 列表项加载骨架屏（P1 · 中优先级）

**现状**：无骨架屏，筛选切换时无加载状态。

**建议**：添加文章列表项骨架屏（3-5 行占位符）：

```tsx
function ArticleSkeleton() {
  return (
    <div className="animate-pulse rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="h-5 w-3/4 rounded bg-slate-200" />
          <div className="mt-2 h-3 w-1/3 rounded bg-slate-100" />
        </div>
        <div className="h-5 w-16 rounded bg-slate-200" />
      </div>
    </div>
  );
}
```

---

## 7. 已读历史 (History Page)

### 7.1 与 FeedList 共用组件逻辑（P0 · 高优先级）

**现状**：`HistoryList.tsx` 和 `FeedList.tsx` 有大量重复代码（搜索栏、分页、日期桶分组）。

**建议**：提取共同逻辑到一个可复用的 `ArticleListLayout` 组件，减少代码重复。差异点通过 props 控制：
- 是否显示"全部已读"按钮 (FeedList: 有, History: 无)
- 日期桶基于 `fetchedAt` vs `viewedAt`
- 分页 API 端点 (`/api/feed` vs `/api/history`)

### 7.2 "暂无已读记录"引导性文案（P1 · 中优先级）

**现状**：提示文字还行，但可以更友好。

**建议**：增加箭头或按钮引导用户去资讯流：

```tsx
<div className="flex flex-col items-center py-16">
  <BookOpen className="h-16 w-16 text-slate-200 mb-4" />
  <p className="text-slate-400 font-medium">暂无已读记录</p>
  <Link href="/" className="mt-3 inline-flex items-center gap-1.5 text-sm text-indigo-600 hover:text-indigo-800 transition-colors">
    前往资讯流 <ArrowRight className="h-3.5 w-3.5" />
  </Link>
</div>
```

---

## 8. 运行日志 (Runs Page)

### 8.1 状态实时更新指示器（P1 · 中优先级）

**现状** (`RunsTable.tsx`): "自动刷新中" 的文字提示不够醒目。

**建议**：首行添加一个绿色呼吸点（带 lastRefresh 时间）：
- `<span className="inline-flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />`
- 页面上次刷新时间格式化为相对时间（"12 秒前"）

### 8.2 表格行的状态动画（P1 · 中优先级）

**现状**：运行中的任务行使用 `bg-indigo-50/50` 背景，但状态变化时（running → success/error）无过渡。

**建议**：
- 任务从 running 变为 success 时，行背景从 `bg-indigo-50/50` 平滑过渡到透明
- 新出现的 completed 任务行有短暂的入场动画（slideInLeft）

### 8.3 运行时长显示（P2 · 低优先级）

**现状**：表格只有开始时间，无运行时长。

**建议**：对于已完成的 run，显示耗时（如 "12.3s"、"2m45s"）。

```tsx
function formatDuration(start: string, end: string | null): string {
  if (!end) return "—";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m${Math.round((ms % 60000) / 1000)}s`;
}
```

### 8.4 错误信息可展开（P2 · 低优先级）

**现状**：message 列使用 `truncate` 截断，无法看到完整错误信息。

**建议**：点击截断的消息文本，展开/收起完整信息（tooltip 或就地展开）。

---

## 9. 站点管理 (Sites Pages)

### 9.1 批量操作栏添加入场/出场动画（P1 · 中优先级）

**现状** (`SitesList.tsx`): 选中站点后，批量操作栏以 `{selectedIds.size > 0 && <div>...}` 的方式出现/消失，无过渡。

**建议**：使用 `transition-all` + max-height 实现平滑出现：

```tsx
<div className={`overflow-hidden transition-all duration-300 ${
  selectedIds.size > 0 ? "max-h-20 opacity-100 mb-4" : "max-h-0 opacity-0 mb-0"
}`}>
```

### 9.2 站点启用/禁用切换动画（P1 · 中优先级）

**现状** (`SiteCard.tsx`): 切换状态后，卡片只是 `opacity-60` 变化。

**建议**：
- 切换开关时增加绿色/灰色过渡动画
- 禁用状态的卡片淡入淡出过渡（`transition-opacity duration-300`）

### 9.3 站点编辑表单的分步向导（P2 · 低优先级）

**现状** (`edit-form.tsx`): 所有配置挤在一个长页面中滚动。

**建议**：使用分步（Step）式表单，尤其对新站点创建：
1. 步骤 1：必要信息（名称 + URL） + AI 识别
2. 步骤 2：站点配置（分类、渲染、AI 参与度、Scope）
3. 步骤 3：CSS 选择器微调

或使用可折叠的 section（`<details>`），默认展开"必要信息"。

### 9.4 AI 识别按钮的加载动画优化（P1 · 中优先级）

**现状**：AI 识别按钮在分析中显示 `<SpinnerIcon />` + "分析中…（约需 10-30 秒）"。

**建议**：
- 显示已等待的时间（"分析中… 8s" 每 2 秒更新一次）
- Spinner 旁边加一个小提示："正在进行 AI 页面分析，请稍候"
- 成功时按钮短暂变为绿色 ✓再恢复

### 9.5 站点卡片添加 Tooltip（P2 · 低优先级）

**现状** (`SiteCard.tsx`): URL 和选择器信息在卡片底部以 `text-xs` 展示，内容多时占据空间。

**建议**：
- URL 区域使用 tooltip 显示完整 URL（hover 展示）
- 选择器信息默认折叠，点击 "详情 ▼" 展开

### 9.6 URL 输入区域的"测试可达性"按钮（P2 · 低优先级）

**现状**：添加 URL 后无法快速验证是否能访问。

**建议**：每个 URL 输入框旁边添加一个"测试"小按钮：
- 点击后发送 HEAD/GET 请求
- 成功 → 显示绿色 ✓
- 失败 → 显示红色 ✗ + 错误原因

---

## 10. 登录页 (Login Page)

### 10.1 页面视觉增强（P1 · 中优先级）

**现状** (`login/page.tsx`): 白底卡片居中，非常朴素。

**建议**：
1. 添加产品 Logo 或大号图标在表单上方
2. 背景添加微弱的渐变或几何图案装饰
3. 输入框添加图标前缀（User, Lock）
4. 表单提交时按钮显示 spinner + "登录中…"（已有），但 spinner 可用图标库的 `<Loader />`

```tsx
<div className="mb-8 text-center">
  <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-100">
    <Bot className="h-7 w-7 text-indigo-600" />
  </div>
  <h1 className="text-2xl font-bold text-slate-900">科技情报采集器</h1>
  <p className="mt-1 text-sm text-slate-500">请登录以继续</p>
</div>
```

### 10.2 登录错误抖动动画（P1 · 中优先级）

**现状**：错误信息以红色背景框展示，无动画。

**建议**：登录失败时，表单整体微微抖动（shake animation）：

```css
@keyframes shake {
  0%, 100% { transform: translateX(0); }
  20% { transform: translateX(-4px); }
  40% { transform: translateX(4px); }
  60% { transform: translateX(-3px); }
  80% { transform: translateX(3px); }
}

.shake {
  animation: shake 0.4s ease-in-out;
}
```

### 10.3 按 Enter 提交的视觉提示（P2 · 低优先级）

**现状**：表单使用 `<form onSubmit>`，Enter 键可提交，但无提示。

**建议**：按钮文字 "登录" 改为 "登录 ↵"（仅在桌面端），暗示回车可提交。

---

## 11. 全局 CSS 与动画系统

### 11.1 定义统一的动画 Token（P1 · 中优先级）

**现状** (`globals.css`): 仅 `@import "tailwindcss"`，无自定义 CSS。

**建议**：在 `globals.css`（或 Tailwind `@theme` 中）定义标准动画：

```css
@import "tailwindcss";

@theme {
  --animate-fade-in: fade-in 0.2s ease-out;
  --animate-slide-up: slide-up 0.3s ease-out;
  --animate-slide-down: slide-down 0.3s ease-out;
  --animate-scale-in: scale-in 0.2s ease-out;
  --animate-shake: shake 0.4s ease-in-out;
  --animate-slide-in-right: slide-in-right 0.3s ease-out;
}

@keyframes fade-in {
  from { opacity: 0; }
  to   { opacity: 1; }
}

@keyframes slide-up {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}

@keyframes slide-down {
  from { opacity: 0; transform: translateY(-8px); }
  to   { opacity: 1; transform: translateY(0); }
}

@keyframes scale-in {
  from { opacity: 0; transform: scale(0.95); }
  to   { opacity: 1; transform: scale(1); }
}

@keyframes shake {
  0%, 100% { transform: translateX(0); }
  20%      { transform: translateX(-4px); }
  40%      { transform: translateX(4px); }
  60%      { transform: translateX(-3px); }
  80%      { transform: translateX(3px); }
}

@keyframes slide-in-right {
  from { opacity: 0; transform: translateX(100%); }
  to   { opacity: 1; transform: translateX(0); }
}

@keyframes shimmer {
  0%   { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}
```

### 11.2 页面过渡动画（P2 · 低优先级）

**现状**：页面间切换无过渡，瞬时渲染。

**建议**：在 `layout.tsx` 中对 `{children}` 包裹简单的 fade-in 动画：

```tsx
<main className="animate-fade-in">
  {children}
</main>
```

注意：这是纯 CSS 过渡，不依赖 `framer-motion`。对于真正的页面过渡，可使用 Next.js `template.tsx`（替代 `layout.tsx` 中的部分逻辑）以在每次导航时重新挂载。

### 11.3 hover 效果系统化（P2 · 低优先级）

**现状**：hover 样式不统一，有的用 `hover:bg-slate-50`，有的用 `hover:border-indigo-300`。

**建议**：在 Tailwind 中定义统一的交互类（若 Tailwind v4 支持 `@utility`）：

```css
@utility interactive-hover {
  @apply transition-all duration-200 hover:shadow-sm hover:-translate-y-0.5;
}

@utility card {
  @apply rounded-xl border border-slate-200 bg-white;
}
```

或至少确保所有可交互元素使用统一的 transition `transition-all duration-200`。

---

## 12. 优先级排序与实施路线

### 🚀 Phase 1（2-3 天）：速赢项

| 序号 | 改进项 | 预估工时 | 影响 |
|------|--------|----------|------|
| 1 | 引入 lucide-react，替换所有 emoji 图标 | 2h | 视觉统一性大幅提升 |
| 2 | Toast 通知系统 | 3h | 操作反馈规范化 |
| 3 | 导航栏当前路由高亮 | 0.5h | 导航可用性明显改善 |
| 4 | 文章详情页阅读进度条 | 0.5h | 长文阅读体验 |
| 5 | 搜索防抖 (debounce) | 0.5h | 输入流畅度 |
| 6 | 卡片入场动画 (staggered) | 1h | 列表视觉品质 |
| 7 | 统计卡片数字滚动动画 | 1h | 仪表盘吸引力 |
| 8 | FeedList/HistoryList 重复代码抽取 | 2h | 代码维护性 |

### 📦 Phase 2（2-3 天）：体验升级

| 序号 | 改进项 | 预估工时 | 影响 |
|------|--------|----------|------|
| 1 | 全部操作的 toast 接入 | 2h | 全局反馈完善 |
| 2 | 全局 CSS 动画 Token + Tailwind @theme | 1h | 动画基础设施 |
| 3 | 空状态插图 (所有页面) | 1.5h | 异常状态体验 |
| 4 | 登录页视觉增强 + 抖动动画 | 1h | 第一印象 |
| 5 | 审核指标可视化 (质量分环形图) | 1.5h | 数据可读性 |
| 6 | 收藏按钮动画增强 (star pop) | 0.5h | 微交互品质 |
| 7 | 移动端菜单动画过渡 | 1h | 移动端体验 |
| 8 | "全部已读"进度动画 | 1h | 批量操作反馈 |

### 🎨 Phase 3（3-5 天）：进阶增强

| 序号 | 改进项 | 预估工时 | 影响 |
|------|--------|----------|------|
| 1 | 暗色模式 | 4h | 用户舒适度 |
| 2 | 站点管理表单分步/折叠 | 2h | 复杂表单可用性 |
| 3 | AI 分析按钮计时器 + 成功动画 | 1h | 等待体验 |
| 4 | 返回顶部按钮 | 0.5h | 长页面导航 |
| 5 | 面包屑导航 | 1h | 页面位置感知 |
| 6 | 批量操作栏动画 (站点管理) | 1h | 交互连贯性 |
| 7 | 运行日志耗时显示 + 状态过渡 | 1.5h | 日志可读性 |
| 8 | 分类分组折叠/展开 | 1h | 长列表控制 |

### 🔮 Phase 4（后续迭代）：锦上添花

| 序号 | 改进项 | 预估工时 |
|------|--------|----------|
| 1 | 键盘快捷键支持 + 命令面板 | 4h |
| 2 | 无限滚动 (资讯流移动端) | 2h |
| 3 | 页面过渡动画 | 2h |
| 4 | 分享/复制链接按钮 | 0.5h |
| 5 | URL 可达性测试按钮 | 1h |
| 6 | Tooltip 系统 (hover 详情) | 2h |
| 7 | 触觉反馈 (移动端) | 0.5h |

---

## 附录 A：推荐依赖项

```json
{
  "dependencies": {
    "lucide-react": "^0.x"         // 图标库（零依赖）
  }
}
```

> **不推荐 `framer-motion`**：对于本项目规模，CSS 动画 + Tailwind 足够覆盖 90% 场景，额外引入 30KB+ 的 `framer-motion` 性价比不高。若需要 layoutId 动画（如导航指示器滑动），可用 CSS 实现或小体积方案。

## 附录 B：CSS 变量参考（Tailwind v4 @theme）

```css
@import "tailwindcss";

@theme {
  /* 动画 */
  --animate-fade-in: fade-in 0.2s ease-out;
  --animate-slide-up: slide-up 0.3s ease-out;
  --animate-slide-down: slide-down 0.3s ease-out;
  --animate-scale-in: scale-in 0.2s ease-out;
  --animate-shake: shake 0.4s ease-in-out;
  --animate-slide-in-right: slide-in-right 0.3s ease-out;
  --animate-shimmer: shimmer 1.5s infinite;
  --animate-star-pop: star-pop 0.3s ease-out;

  /* 阴影增强 */
  --shadow-card-hover: 0 4px 12px rgba(0, 0, 0, 0.08);
  --shadow-toast: 0 8px 24px rgba(0, 0, 0, 0.12);

  /* 圆角统一 */
  --radius-card: var(--radius-xl);
  --radius-button: var(--radius-lg);
  --radius-badge: var(--radius-full);
}
```

## 附录 C：Toast 类型定义参考

```typescript
// app/components/ToastProvider.tsx
type ToastType = "success" | "error" | "info" | "warning";

interface Toast {
  id: string;
  type: ToastType;
  message: string;
  duration?: number; // ms, default 4000
}

interface ToastContextValue {
  success: (msg: string) => void;
  error: (msg: string) => void;
  info: (msg: string) => void;
  warning: (msg: string) => void;
}

// 每个 toast 的图标映射
// success → <CheckCircle2 className="h-4 w-4 text-emerald-500" />
// error   → <XCircle className="h-4 w-4 text-red-500" />
// info    → <Info className="h-4 w-4 text-blue-500" />
// warning → <AlertTriangle className="h-4 w-4 text-amber-500" />
```

---

> **总结**：本项目 UI 基础扎实（Tailwind CSS + 清晰组件结构），UX 改进的重点在于：统一图标体系 → 增加动效过渡 → 完善反馈机制 → 优化移动端细节。建议按 Phase 1 → 2 → 3 的顺序迭代实施，每个 Phase 完成后评估效果再推进。
