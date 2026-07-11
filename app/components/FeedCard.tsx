"use client";

import { useState, useCallback, useRef } from "react";
import Link from "next/link";
import { Star, Eye } from "lucide-react";

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
  /** 卡片动画延迟 index（0-based） */
  animIndex?: number;
}

const SWIPE_THRESHOLD = 80; // px，触发操作所需的滑动距离
const SWIPE_MAX = 140;      // px，滑动偏移的最大值（阻尼上限）

/** 滑动方向 */
type SwipeDir = "none" | "left" | "right";

/**
 * Feed 文章卡片。
 *
 * 桌面端：hover 显示星标 + 已阅读按钮。
 * 移动端：左滑标记已读（绿色提示），右滑切换收藏（金色提示）。
 */
export function FeedCard({ article }: { article: ArticleItem }) {
  const [state, setState] = useState<
    "idle" | "loading" | "dismissing" | "dismissed" | "error"
  >("idle");
  const [saved, setSaved] = useState(article.savedAt != null);
  const [saving, setSaving] = useState(false);
  const [starAnim, setStarAnim] = useState(false);

  // ---------- swipe ----------
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const [swipeDelta, setSwipeDelta] = useState(0);   // px
  const [swipeDir, setSwipeDir] = useState<SwipeDir>("none");
  const [swipeCommitted, setSwipeCommitted] = useState(false);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (state === "dismissing" || state === "loading") return;
    const t = e.touches[0];
    touchStartX.current = t.clientX;
    touchStartY.current = t.clientY;
    setSwipeDelta(0);
    setSwipeDir("none");
  }, [state]);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (state === "dismissing" || state === "loading") return;
    const dx = e.touches[0].clientX - touchStartX.current;
    const dy = e.touches[0].clientY - touchStartY.current;

    // 竖直滚动主导时不拦截
    if (Math.abs(dy) > Math.abs(dx)) {
      setSwipeDelta(0);
      setSwipeDir("none");
      return;
    }

    // 阻尼：超过 SWIPE_MAX 后缓慢增加
    const damped = Math.sign(dx) * Math.min(Math.abs(dx), SWIPE_MAX);
    setSwipeDelta(damped);

    if (Math.abs(dx) > 20) {
      setSwipeDir(dx > 0 ? "right" : "left");
    }
  }, [state]);

  const onTouchEnd = useCallback(() => {
    if (state === "dismissing" || state === "loading") return;

    const dx = swipeDelta;

    if (swipeDir === "left" && Math.abs(dx) >= SWIPE_THRESHOLD) {
      // 左滑 → 已阅读
      setSwipeCommitted(true);
      setState("loading");
      (async () => {
        try {
          const res = await fetch(`/api/articles/${article.id}/view`, { method: "POST" });
          if (!res.ok) throw new Error("mark read failed");
          setState("dismissing");
          setTimeout(() => setState("dismissed"), 300);
        } catch {
          setState("error");
          setSwipeCommitted(false);
          setSwipeDelta(0);
          setSwipeDir("none");
          setTimeout(() => { setState((s) => (s === "error" ? "idle" : s)); }, 4000);
        }
      })();
    } else if (swipeDir === "right" && Math.abs(dx) >= SWIPE_THRESHOLD) {
      // 右滑 → 收藏
      setSwipeCommitted(true);
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
          // 回弹
          setSwipeCommitted(false);
          setSwipeDelta(0);
          setSwipeDir("none");
        }
      })();
    } else {
      // 不够远，回弹
      setSwipeDelta(0);
      setSwipeDir("none");
    }
  }, [swipeDelta, swipeDir, state, saved, article, setState]);

  // ---------- click (desktop) ----------
  async function markRead(e: React.MouseEvent) {
    e.preventDefault();
    if (state !== "idle" && state !== "error") return;
    setState("loading");
    try {
      const res = await fetch(`/api/articles/${article.id}/view`, { method: "POST" });
      if (!res.ok) throw new Error("mark read failed");
      setState("dismissing");
      setTimeout(() => setState("dismissed"), 300);
    } catch {
      setState("error");
      setTimeout(() => { setState((s) => (s === "error" ? "idle" : s)); }, 4000);
    }
  }

  async function toggleSave(e: React.MouseEvent) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    const prev = saved;
    setSaved(!saved);
    // trigger star pop animation
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
  const isSwiping = swipeDir !== "none" && !swipeCommitted;
  const animDelay = article.animIndex != null ? `${article.animIndex * 50}ms` : undefined;

  // 滑动背景指示器颜色
  const swipeIndicatorColor = swipeDir === "left"
    ? "bg-emerald-500"   // 左滑 = 已读 = 绿色
    : swipeDir === "right"
    ? "bg-amber-400"     // 右滑 = 收藏 = 金色
    : "";

  const swipeIndicatorIcon = swipeDir === "left" ? "✓ 已阅读" : swipeDir === "right" ? (saved ? "★ 取消" : "☆ 收藏") : "";

  return (
    <div className="relative overflow-hidden rounded-xl" style={animDelay ? { animationDelay: animDelay } : undefined}>
      {/* ---- 滑动背景层 ---- */}
      {isSwiping && (
        <div
          className={`absolute inset-0 flex items-center transition-colors duration-150 rounded-xl ${
            swipeDir === "left"
              ? "justify-end pr-6 bg-emerald-500/15"
              : "justify-start pl-6 bg-amber-400/15"
          }`}
        >
          <span
            className={`text-sm font-bold tracking-wide ${
              swipeDir === "left" ? "text-emerald-600" : "text-amber-600"
            }`}
          >
            {swipeIndicatorIcon}
          </span>
        </div>
      )}

      {/* ---- 卡片主体（可滑动层）---- */}
      <div
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        className={`relative group flex items-center rounded-xl border p-4 transition-all duration-300 ease-out bg-white select-none animate-card-enter ${
          isDismissing
            ? "opacity-0 -translate-y-2 blur-[2px] pointer-events-none"
            : isError
            ? "border-red-200 bg-red-50/30"
            : saved && !isSwiping
            ? "border-amber-200 bg-amber-50/30 hover:border-amber-300"
            : "border-slate-200 hover:border-indigo-300 hover:shadow-sm"
        } ${swipeCommitted ? "" : ""}`}
        style={
          swipeDelta !== 0 || swipeCommitted
            ? { transform: `translateX(${swipeDelta}px)`, transition: swipeCommitted ? "none" : undefined }
            : animDelay ? { animationDelay: animDelay } : undefined
        }
      >
        {/* 收藏星标 (desktop) */}
        <button
          onClick={toggleSave}
          disabled={saving}
          className={`mr-2 shrink-0 leading-none transition-colors ${
            saved
              ? "text-amber-400 hover:text-amber-300"
              : "text-slate-300 hover:text-amber-400 opacity-0 group-hover:opacity-100"
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
          <div className="font-medium text-slate-900 group-hover:text-indigo-600 transition-colors line-clamp-1">
            {displayTitle}
          </div>
          {article.headline && article.title && article.headline !== article.title ? (
            <p className="text-xs text-slate-400 line-clamp-1 mt-0.5">
              原文：{article.title}
            </p>
          ) : null}
          {article.summary ? (
            <p className="mt-1 text-sm text-slate-500 line-clamp-2">
              {article.summary}
            </p>
          ) : null}

          {(article.tags && article.tags.length > 0) || article.qualityScore != null ? (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {article.tags?.map((tag) => (
                <span
                  key={tag}
                  className="inline-block rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-600"
                >
                  {tag}
                </span>
              ))}
              {article.qualityScore != null && (
                <span className="inline-flex items-center gap-0.5 text-[11px] text-amber-600">
                  <Star className="h-2.5 w-2.5 fill-amber-400 text-amber-400" />
                  {article.qualityScore.toFixed(1)}
                </span>
              )}
            </div>
          ) : null}

          <div className="mt-1 flex items-center gap-2 text-xs text-slate-400">
            <span>{article.siteName}</span>
            <span>·</span>
            <span>
              {article.publishedAt
                ? new Date(article.publishedAt).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" })
                : article.fetchedAt
                ? new Date(article.fetchedAt).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" })
                : "-"}
            </span>
            {/* 移动端：已收藏小标记 */}
            {saved && <span className="text-amber-400 sm:hidden"><Star className="h-3 w-3 fill-amber-400" /></span>}
          </div>
        </Link>

        {/* 已阅读按钮 (desktop) */}
        <button
          onClick={markRead}
          disabled={state === "loading" || isDismissing}
          className={`ml-3 shrink-0 inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs transition-colors hidden sm:flex ${
            isError
              ? "border-red-300 text-red-600 hover:border-red-400 hover:bg-red-50"
              : "border-slate-200 text-slate-400 hover:border-slate-300 hover:text-slate-600 hover:bg-slate-50"
          } ${state === "loading" ? "opacity-50" : ""}`}
        >
          <Eye className="h-3.5 w-3.5" />
          {state === "loading" ? "…" : isError ? "重试" : "已阅读"}
        </button>

        {/* 移动端：滑动提示条 */}
        <div className="ml-2 shrink-0 text-[10px] text-slate-300 hidden max-sm:block leading-tight text-right">
          ← →<br />滑动
        </div>
      </div>
    </div>
  );
}
