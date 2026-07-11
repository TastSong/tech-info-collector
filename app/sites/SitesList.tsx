"use client";

import { useState, useCallback } from "react";
import { SiteCard } from "@/app/components/SiteCard";

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

interface Props {
  sites: SiteInfo[];
  articleCounts: Record<number, number>;
}

export function SitesList({ sites: initialSites, articleCounts }: Props) {
  const [sites, setSites] = useState(initialSites);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [batching, setBatching] = useState(false);

  const handleSelect = useCallback((id: number, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    setSelectedIds((prev) => {
      if (prev.size === sites.length) {
        return new Set();
      }
      return new Set(sites.map((s) => s.id));
    });
  }, [sites]);

  const allSelected = sites.length > 0 && selectedIds.size === sites.length;

  async function batchToggle(enabled: boolean) {
    if (selectedIds.size === 0) return;
    setBatching(true);
    try {
      const res = await fetch("/api/sites/batch/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ids: Array.from(selectedIds),
          enabled,
        }),
      });
      if (res.ok) {
        // 直接更新本地状态，被选中的站点 enabled 全部置为目标值
        const selectedSet = selectedIds;
        setSites((prev) =>
          prev.map((s) =>
            selectedSet.has(s.id) ? { ...s, enabled } : s,
          ),
        );
        setSelectedIds(new Set());
      }
    } catch {
      // 静默
    } finally {
      setBatching(false);
    }
  }

  return (
    <div>
      {/* 批量操作栏 */}
      {selectedIds.size > 0 && (
        <div className={`overflow-hidden transition-all duration-300 ${
          selectedIds.size > 0 ? "max-h-20 opacity-100 mb-4" : "max-h-0 opacity-0 mb-0"
        }`}>
          <div className="flex items-center gap-3 rounded-lg border border-indigo-200 bg-indigo-50/60 px-4 py-3">
            <span className="text-sm font-medium text-indigo-800">
              已选 {selectedIds.size} 个站点
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => batchToggle(true)}
                disabled={batching}
                className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors cursor-pointer"
              >
                {batching ? "处理中…" : "批量启用"}
              </button>
              <button
                type="button"
                onClick={() => batchToggle(false)}
                disabled={batching}
                className="inline-flex items-center gap-1 rounded-md bg-slate-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-600 disabled:opacity-50 transition-colors cursor-pointer"
              >
                {batching ? "处理中…" : "批量禁用"}
              </button>
            </div>
            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              className="ml-auto text-xs text-slate-500 hover:text-slate-700 cursor-pointer"
            >
              取消选择
            </button>
          </div>
        </div>
      )}

      {/* 表头 */}
      <div className="mb-3 flex items-center gap-3 px-1">
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={handleSelectAll}
            className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
          />
          <span className="text-xs text-slate-500">
            {allSelected ? "取消全选" : "全选"}
          </span>
        </label>
        <span className="text-xs text-slate-400">
          {sites.filter((s) => s.enabled).length} / {sites.length} 启用
        </span>
      </div>

      {/* 站点卡片列表 */}
      <div className="space-y-4">
        {sites.map((s) => (
          <SiteCard
            key={s.id}
            site={s}
            articleCount={articleCounts[s.id] ?? 0}
            selectable
            selected={selectedIds.has(s.id)}
            onSelect={handleSelect}
          />
        ))}
      </div>
    </div>
  );
}
