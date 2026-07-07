"use client";

import { useState } from "react";
import { renderBadge } from "./Badges";

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
}: {
  site: SiteInfo;
  articleCount: number;
}) {
  const [site, setSite] = useState(initialSite);
  const [toggling, setToggling] = useState(false);

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
      className={`rounded-xl border bg-white p-5 transition-opacity ${
        site.enabled ? "border-slate-200" : "border-slate-100 opacity-60"
      }`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-medium text-slate-900">{site.name}</span>
            {renderBadge(site.render)}
            <button
              onClick={toggle}
              disabled={toggling}
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors cursor-pointer ${
                site.enabled
                  ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                  : "bg-slate-100 text-slate-500 hover:bg-slate-200"
              }`}
            >
              <span
                className={`inline-block h-2 w-2 rounded-full ${
                  site.enabled ? "bg-emerald-500" : "bg-slate-400"
                }`}
              />
              {site.enabled ? "启用" : "禁用"}
            </button>
          </div>
          <div className="mt-1 text-xs text-slate-500">
            {site.category}
            {site.subcategory ? ` / ${site.subcategory}` : ""} ·{" "}
            AI: {site.aiInvolvement}
          </div>
        </div>
        <div className="text-right text-sm text-slate-500">
          <div>{articleCount} 篇</div>
          {site.lastRunAt ? (
            <div className="text-xs text-slate-400">
              上次：{new Date(site.lastRunAt).toLocaleDateString("zh-CN", {timeZone: "Asia/Shanghai"})}
            </div>
          ) : null}
        </div>
      </div>

      {/* URLs + selectors */}
      <div className="mt-3 space-y-1 text-xs text-slate-400">
        <div>
          URLs：{site.urls.map((u) => (
            <code key={u} className="ml-1 rounded bg-slate-50 px-1 break-all">
              {u}
            </code>
          ))}
        </div>
        {site.listSelector ? (
          <div className="break-all">
            选择器：list=<code className="rounded bg-slate-50 px-1">{site.listSelector}</code>{" "}
            / link=<code className="rounded bg-slate-50 px-1">{site.linkSelector ?? "-"}</code>{" "}
            / body=<code className="rounded bg-slate-50 px-1">{site.bodySelector ?? "自动"}</code>
          </div>
        ) : null}
        <div>scope：{site.scope ?? "（未设置）"}</div>
      </div>
    </div>
  );
}
