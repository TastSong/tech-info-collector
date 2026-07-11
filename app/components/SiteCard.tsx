"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { renderBadge } from "./Badges";
import { Edit3, Circle, Eye, EyeOff } from "lucide-react";

interface SiteInfo {
  id: number;
  name: string;
  category: string | null;
  subcategory: string | null;
  urls: string[];
  render: string;
  enabled: boolean;
  aiInvolvement: string;
  listSelector: string | null;
  linkSelector: string | null;
  bodySelector: string | null;
  scope: string | null;
  lastRunAt: Date | null;
}

export function SiteCard({
  site: initialSite,
  articleCount,
  selectable = false,
  selected = false,
  onSelect,
}: {
  site: SiteInfo;
  articleCount: number;
  selectable?: boolean;
  selected?: boolean;
  onSelect?: (id: number, checked: boolean) => void;
}) {
  const [site, setSite] = useState(initialSite);
  const [toggling, setToggling] = useState(false);

  // 当外部 props 变化时同步本地状态（批量操作时父组件会传入新的 enabled）
  const prevEnabled = useRef(initialSite.enabled);
  useEffect(() => {
    if (initialSite.enabled !== prevEnabled.current) {
      setSite((prev) => ({ ...prev, enabled: initialSite.enabled }));
      prevEnabled.current = initialSite.enabled;
    }
  }, [initialSite.enabled]);

  async function toggle() {
    setToggling(true);
    try {
      const res = await fetch(`/api/sites/${site.id}/toggle`, {
        method: "POST",
      });
      if (res.ok) {
        const data = await res.json();
        setSite({ ...site, enabled: data.enabled });
      }
    } catch {
      // 静默
    } finally {
      setToggling(false);
    }
  }

  return (
    <div
      className={`rounded-xl border bg-white p-5 transition-all duration-300 flex items-start gap-3 dark:bg-slate-900 ${
        site.enabled ? "border-slate-200 dark:border-slate-800" : "border-slate-100 opacity-60 dark:border-slate-800"
      }`}
    >
      {selectable && (
        <input
          type="checkbox"
          checked={selected}
          onChange={(e) => onSelect?.(site.id, e.target.checked)}
          className="mt-1 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer shrink-0"
        />
      )}
      <div className="flex-1 min-w-0">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href={`/sites/${site.id}`}
              className="font-medium text-slate-900 hover:text-indigo-600 transition-colors dark:text-slate-100 dark:hover:text-indigo-400"
            >
              {site.name}
            </Link>
            {renderBadge(site.render)}
            <button
              onClick={toggle}
              disabled={toggling}
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium transition-all cursor-pointer ${
                site.enabled
                  ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950 dark:text-emerald-400 dark:hover:bg-emerald-900"
                  : "bg-slate-100 text-slate-500 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700"
              }`}
            >
              {site.enabled ? (
                <>
                  <Circle className="h-2 w-2 fill-emerald-500 text-emerald-500" />
                  <Eye className="h-3 w-3" />
                  启用
                </>
              ) : (
                <>
                  <Circle className="h-2 w-2 fill-slate-400 text-slate-400" />
                  <EyeOff className="h-3 w-3" />
                  禁用
                </>
              )}
            </button>
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {site.category}
            {site.subcategory ? ` / ${site.subcategory}` : ""} ·{" "}
            AI: {site.aiInvolvement}
          </div>
        </div>
        <div className="flex items-start gap-3">
          <Link
            href={`/sites/${site.id}`}
            className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 transition-colors dark:bg-indigo-950 dark:text-indigo-400 dark:hover:bg-indigo-900"
          >
            <Edit3 className="h-3.5 w-3.5" />
            编辑
          </Link>
          <div className="text-right text-sm text-slate-500 dark:text-slate-400">
            <div>{articleCount} 篇</div>
            {site.lastRunAt ? (
              <div className="text-xs text-slate-400 dark:text-slate-500">
                上次：{new Date(site.lastRunAt).toLocaleDateString("zh-CN", {timeZone: "Asia/Shanghai"})}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {/* URLs + selectors */}
      <div className="mt-3 space-y-1 text-xs text-slate-400 dark:text-slate-500">
        <div>
          URLs：{site.urls.map((u) => (
            <code key={u} className="ml-1 rounded bg-slate-50 px-1 break-all dark:bg-slate-800">
              {u}
            </code>
          ))}
        </div>
        {site.listSelector ? (
          <div className="break-all">
            选择器：list=<code className="rounded bg-slate-50 px-1 dark:bg-slate-800">{site.listSelector}</code>{" "}
            / link=<code className="rounded bg-slate-50 px-1 dark:bg-slate-800">{site.linkSelector ?? "-"}</code>{" "}
            / body=<code className="rounded bg-slate-50 px-1 dark:bg-slate-800">{site.bodySelector ?? "自动"}</code>
          </div>
        ) : null}
        <div>scope：{site.scope ?? "（未设置）"}</div>
      </div>
      </div>
    </div>
  );
}
