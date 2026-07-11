"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import Link from "next/link";
import { Star, Eye } from "lucide-react";
import { useToast } from "./Toast";

interface ArticleItem {
  id: number;
  title: string | null;
  headline: string | null;
  fetchedAt: string | Date | null;
  publishedAt: string | Date | null;
  siteName: string | null;
  summary: string | null;
  tags?: string[];
  qualityScore?: number | null;
  savedAt?: string | Date | null;
  onToggleSaved?: (id: number, saved: boolean) => void;
  animIndex?: number;
}

const SWIPE_THRESHOLD = 80;

/**
 * Feed 文章卡片。
 *
 * 桌面端：hover 显示星标 + 已阅读按钮。
 * 移动端：左滑飞离屏幕标记已读，右滑回弹切换收藏。
 *
 * 拖拽期间使用 ref 直接操作 DOM（无 React 状态变更），
 * 松手后由 CSS transition-all 接管回弹/飞离动画。
 */
export function FeedCard({ article }: { article: ArticleItem }) {
  const toast = useToast();
  const [state, setState] = useState<
    "idle" | "loading" | "dismissing" | "dismissed" | "error"
  >("idle");
  const [saved, setSaved] = useState(article.savedAt != null);
  const [saving, setSaving] = useState(false);
  const [starAnim, setStarAnim] = useState(false);
  // 入场动画完成后移除 animate-card-enter（避免 animation-fill-mode:both 覆盖拖拽 transform）
  const [enterDone, setEnterDone] = useState(!article.animIndex); // 无 animIndex（如筛选结果）不播动画

  useEffect(() => {
    if (article.animIndex == null) return;
    const t = setTimeout(() => setEnterDone(true), 400); // 动画 350ms + 50ms 缓冲
    return () => clearTimeout(t);
  }, [article.animIndex]);

  // ── swipe refs（直接 DOM 操作，避免 touchMove 每帧触发 React 重渲染）──
  const cardRef = useRef<HTMLDivElement>(null);
  const bgRef = useRef<HTMLDivElement>(null);
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const dragOffset = useRef(0); // 累计位移
  const [swipeDir, setSwipeDir] = useState<"none" | "left" | "right">("none");

  // 应用拖拽位移到 DOM（不经过 React state）
  const applyDrag = (offset: number) => {
    if (!cardRef.current) return;
    cardRef.current.style.transition = "none";
    cardRef.current.style.transform = `translateX(${offset}px)`;

    // 背景指示器透明度跟随拖拽距离
    if (bgRef.current) {
      const ratio = Math.min(Math.abs(offset) / SWIPE_THRESHOLD, 1);
      bgRef.current.style.opacity = String(ratio);
    }
  };

  // 回弹（松手后由 CSS transition 接管）
  const snapBack = () => {
    if (cardRef.current) {
      cardRef.current.style.removeProperty("transition");
      cardRef.current.style.removeProperty("transform");
    }
    if (bgRef.current) {
      bgRef.current.style.removeProperty("opacity");
    }
  };

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (state !== "idle" && state !== "error") return;
    const t = e.touches[0];
    touchStartX.current = t.clientX;
    touchStartY.current = t.clientY;
    dragOffset.current = 0;
    setSwipeDir("none");
  }, [state]);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (state !== "idle" && state !== "error") return;
    const dx = e.touches[0].clientX - touchStartX.current;
    const dy = e.touches[0].clientY - touchStartY.current;

    // 竖直滚动主导 → 不拦截
    if (Math.abs(dy) > Math.abs(dx)) {
      if (dragOffset.current !== 0) {
        dragOffset.current = 0;
        snapBack();
        setSwipeDir("none");
      }
      return;
    }

    // 阻尼不超过 140px
    const clamped = Math.max(-140, Math.min(140, dx));
    dragOffset.current = clamped;
    applyDrag(clamped);

    if (Math.abs(dx) > 20) {
      setSwipeDir(dx > 0 ? "right" : "left");
    }
  }, [state]);

  const onTouchEnd = useCallback(() => {
    if (state !== "idle" && state !== "error") return;

    const dx = dragOffset.current;
    const dir = dx > 0 ? "right" : dx < 0 ? "left" : "none";

    // ── 左滑 → 已阅读（飞离屏幕）──
    if (dir === "left" && Math.abs(dx) >= SWIPE_THRESHOLD) {
      setState("loading");
      // 让卡片飞到屏幕外左侧
      if (cardRef.current) {
        cardRef.current.style.transition = "all 0.25s ease-in";
        cardRef.current.style.transform = "translateX(-120%)";
        cardRef.current.style.opacity = "0";
      }
      if (bgRef.current) bgRef.current.style.opacity = "0";

      (async () => {
        try {
          const res = await fetch(`/api/articles/${article.id}/view`, { method: "POST" });
          if (!res.ok) throw new Error("mark read failed");
          setTimeout(() => setState("dismissed"), 280);
        } catch {
          // 失败回弹
          snapBack();
          if (cardRef.current) cardRef.current.style.opacity = "1";
          setState("error");
          setTimeout(() => setState((s) => (s === "error" ? "idle" : s)), 4000);
        }
      })();

    // ── 右滑 → 收藏（回弹动画）──
    } else if (dir === "right" && Math.abs(dx) >= SWIPE_THRESHOLD) {
      // 先回弹
      snapBack();
      setSwipeDir("none");
      const prev = saved;
      setSaved(!saved);
      setSaving(true);
      (async () => {
        try {
          const res = await fetch(`/api/articles/${article.id}/save`, { method: "POST" });
          if (!res.ok) throw new Error("save failed");
          const data = await res.json();
          setSaved(data.saved);
          article.onToggleSaved?.(article.id, data.saved);
        } catch {
          setSaved(prev);
        } finally {
          setSaving(false);
        }
      })();

    // ── 不够远 → 回弹 ──
    } else {
      snapBack();
    }

    setSwipeDir("none");
  }, [state, saved, article, setSaved, setState]);

  // ---------- click (desktop) ----------
  async function markRead(e: React.MouseEvent) {
    e.preventDefault();
    if (state !== "idle" && state !== "error") return;
    setState("loading");
    try {
      const res = await fetch(`/api/articles/${article.id}/view`, { method: "POST" });
      if (!res.ok) throw new Error("mark read failed");
      setState("dismissing");
      if (cardRef.current) {
        cardRef.current.style.transition = "all 0.3s ease-out";
        cardRef.current.style.opacity = "0";
        cardRef.current.style.transform = "translateY(-8px)";
        cardRef.current.style.filter = "blur(2px)";
      }
      setTimeout(() => setState("dismissed"), 300);
    } catch {
      setState("error");
      setTimeout(() => setState((s) => (s === "error" ? "idle" : s)), 4000);
    }
  }

  async function toggleSave(e: React.MouseEvent) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    const prev = saved;
    setSaved(!saved);
    if (!prev) {
      setStarAnim(true);
      setTimeout(() => setStarAnim(false), 300);
    }
    try {
      const res = await fetch(`/api/articles/${article.id}/save`, { method: "POST" });
      if (!res.ok) throw new Error("save failed");
      const data = await res.json();
      setSaved(data.saved);
      article.onToggleSaved?.(article.id, data.saved);
      toast.success(data.saved ? "已收藏" : "已取消收藏");
    } catch {
      setSaved(prev);
    } finally {
      setSaving(false);
    }
  }

  if (state === "dismissed") return null;

  const displayTitle = article.headline || article.title || "(无标题)";
  const isError = state === "error";
  const isDismissing = state === "dismissing";
  const isSwiping = swipeDir !== "none";
  const animDelay = article.animIndex != null ? `${article.animIndex * 50}ms` : undefined;

  const swipeIndicatorIcon = swipeDir === "left"
    ? "✓ 已阅读"
    : swipeDir === "right"
    ? (saved ? "★ 取消" : "☆ 收藏")
    : "";

  return (
    <div className="relative overflow-hidden rounded-xl" style={animDelay ? { animationDelay: animDelay } : undefined}>
      {/* ── 滑动背景指示器 ── */}
      <div
        ref={bgRef}
        className={`absolute inset-0 flex items-center rounded-xl transition-opacity duration-200 ${
          swipeDir === "left"
            ? "justify-end pr-6 bg-emerald-500/15 dark:bg-emerald-950/30"
            : "justify-start pl-6 bg-amber-400/15 dark:bg-amber-950/30"
        }`}
        style={{ opacity: 0 }}
      >
        <span
          className={`text-sm font-bold tracking-wide ${
            swipeDir === "left"
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-amber-600 dark:text-amber-400"
          }`}
        >
          {swipeIndicatorIcon}
        </span>
      </div>

      {/* ── 卡片主体 ── */}
      <div
        ref={cardRef}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        className={`relative group flex items-center rounded-xl border p-4 bg-white dark:bg-slate-900 select-none ${!enterDone ? "animate-card-enter" : ""} transition-all duration-300 ease-out ${
          isDismissing
            ? "opacity-0 -translate-y-2 blur-[2px] pointer-events-none"
            : isError
            ? "border-red-200 dark:border-red-800 bg-red-50/30 dark:bg-red-950/30"
            : saved && !isSwiping
            ? "border-amber-200 dark:border-amber-700 bg-amber-50/30 dark:bg-amber-950/30 hover:border-amber-300"
            : "border-slate-200 dark:border-slate-800 hover:border-indigo-300 dark:hover:border-indigo-500 hover:shadow-sm"
        }`}
        style={animDelay ? { animationDelay: animDelay } : undefined}
      >
        {/* 收藏星标 (desktop) */}
        <button
          onClick={toggleSave}
          disabled={saving}
          className={`mr-2 shrink-0 leading-none transition-colors ${
            saved
              ? "text-amber-400 hover:text-amber-300"
              : "text-slate-300 dark:text-slate-600 hover:text-amber-400 opacity-0 group-hover:opacity-100"
          } ${saving ? "animate-pulse" : ""} ${starAnim ? "animate-star-pop" : ""} hidden sm:block`}
          title={saved ? "取消收藏" : "收藏"}
        >
          <Star
            className="h-[18px] w-[18px]"
            fill={saved ? "currentColor" : "none"}
          />
        </button>

        <Link
          href={`/articles/${article.id}?from=feed`}
          className="flex-1 min-w-0"
        >
          <div className="font-medium text-slate-900 dark:text-slate-100 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors line-clamp-1">
            {displayTitle}
          </div>
          {article.headline && article.title && article.headline !== article.title ? (
            <p className="text-xs text-slate-400 dark:text-slate-500 line-clamp-1 mt-0.5">
              原文：{article.title}
            </p>
          ) : null}
          {article.summary ? (
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400 line-clamp-2">
              {article.summary}
            </p>
          ) : null}

          {(article.tags && article.tags.length > 0) || article.qualityScore != null ? (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {article.tags?.map((tag) => (
                <span
                  key={tag}
                  className="inline-block rounded-full bg-indigo-50 dark:bg-indigo-950 px-2 py-0.5 text-[11px] font-medium text-indigo-600 dark:text-indigo-400"
                >
                  {tag}
                </span>
              ))}
              {article.qualityScore != null && (
                <span className="inline-flex items-center gap-0.5 text-[11px] text-amber-600">
                  <Star className="h-2.5 w-2.5 fill-amber-400 text-amber-400" />
                  {Math.round(article.qualityScore * 10)}
                </span>
              )}
            </div>
          ) : null}

          <div className="mt-1 flex items-center gap-2 text-xs text-slate-400 dark:text-slate-500">
            <span>{article.siteName}</span>
            <span>·</span>
            <span>
              {article.publishedAt
                ? new Date(article.publishedAt).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" })
                : article.fetchedAt
                ? new Date(article.fetchedAt).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" })
                : "-"}
            </span>
            {saved && <span className="text-amber-400 sm:hidden"><Star className="h-3 w-3 fill-amber-400" /></span>}
          </div>
        </Link>

        {/* 已阅读按钮 (desktop) */}
        <button
          onClick={markRead}
          disabled={state === "loading" || isDismissing}
          className={`ml-3 shrink-0 inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs transition-colors hidden sm:flex ${
            isError
              ? "border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 hover:border-red-400 hover:bg-red-50 dark:hover:bg-red-950"
              : "border-slate-200 dark:border-slate-700 text-slate-400 dark:text-slate-400 hover:border-slate-300 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
          } ${state === "loading" ? "opacity-50" : ""}`}
        >
          <Eye className="h-3.5 w-3.5" />
          {state === "loading" ? "…" : isError ? "重试" : "已阅读"}
        </button>

        {/* 移动端：滑动提示栏 */}
        <div className="ml-2 shrink-0 text-[10px] text-slate-300 dark:text-slate-600 hidden max-sm:block leading-tight text-right">
          ← →<br />滑动
        </div>
      </div>
    </div>
  );
}
