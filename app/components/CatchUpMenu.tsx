"use client";

import { useState, useRef, useEffect } from "react";
import { CheckCheck, ChevronDown, Loader2 } from "lucide-react";
import { useToast } from "./Toast";

/**
 * 一键追平下拉菜单 —— 服务端批量清空未读积压。
 *
 * 与 FeedList 的"标记本页已读"互补：后者只清当前 30 条，
 * 本组件直接调用 /api/feed/clear 一次性处理全部积压。
 */
const OPTIONS = [
  { mode: "keep2", label: "保留近 2 天", desc: "前天及更早标记已读" },
  { mode: "today", label: "只保留今天", desc: "昨天及更早标记已读" },
  { mode: "all", label: "清空全部未读", desc: "所有未读标记已读" },
] as const;

interface Props {
  /** 清空成功后的回调（通常用于刷新 feed 第一页） */
  onCleared: () => Promise<void> | void;
  /** 受禁用条件（如 savedOnly 模式下不适用） */
  disabled?: boolean;
}

export function CatchUpMenu({ onCleared, disabled }: Props) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  // 点击外部关闭
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  async function clear(mode: string, label: string) {
    setOpen(false);
    setBusy(mode);
    try {
      const res = await fetch(`/api/feed/clear?mode=${mode}`, { method: "POST" });
      if (!res.ok) throw new Error("clear failed");
      const data = (await res.json()) as { affected?: number };
      const n = data.affected ?? 0;
      toast.success(n > 0 ? `${label}：已清空 ${n} 篇` : "没有需要清空的未读");
      await onCleared();
    } catch {
      toast.error("清空失败，请重试");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        disabled={disabled || busy !== null}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-2 text-sm font-medium text-slate-500 dark:text-slate-400 hover:border-indigo-300 hover:text-indigo-600 dark:hover:border-indigo-500 dark:hover:text-indigo-400 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 transition-colors"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCheck className="h-4 w-4" />}
        {busy ? "处理中…" : "一键追平"}
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute right-0 z-20 mt-1 w-56 rounded-xl border border-slate-200 bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-900">
          {OPTIONS.map((opt) => (
            <button
              key={opt.mode}
              type="button"
              disabled={busy !== null}
              onClick={() => clear(opt.mode, opt.label)}
              className="block w-full rounded-lg px-3 py-2 text-left hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 transition-colors"
            >
              <span className="block text-sm font-medium text-slate-700 dark:text-slate-200">{opt.label}</span>
              <span className="block text-xs text-slate-400 dark:text-slate-500">{opt.desc}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
