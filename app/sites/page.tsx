import Link from "next/link";
import { db, schema } from "@/db/client";
import { sql } from "drizzle-orm";
import { renderBadge } from "../components/Badges";

export const dynamic = "force-dynamic";

export default async function SitesPage() {
  const sites = db.select().from(schema.sites).all();

  // site article counts
  const counts = new Map(
    db
      .select({
        siteId: schema.articles.siteId,
        c: sql<number>`COUNT(*)`,
      })
      .from(schema.articles)
      .groupBy(schema.articles.siteId)
      .all()
      .map((r) => [r.siteId, r.c]),
  );

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">站点配置</h1>
          <p className="mt-1 text-sm text-slate-500">
            {sites.filter((s) => s.enabled).length} / {sites.length} 启用
          </p>
        </div>
      </div>

      <div className="space-y-4">
        {sites.map((s) => (
          <div
            key={s.id}
            className={`rounded-xl border bg-white p-5 ${
              s.enabled ? "border-slate-200" : "border-slate-100 opacity-60"
            }`}
          >
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-3">
                  <span className="font-medium text-slate-900">{s.name}</span>
                  {renderBadge(s.render)}
                  {s.enabled ? (
                    <span className="text-xs font-medium text-emerald-600">
                      启用
                    </span>
                  ) : (
                    <span className="text-xs text-slate-400">禁用</span>
                  )}
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  {s.category}
                  {s.subcategory ? ` / ${s.subcategory}` : ""} ·{" "}
                  {s.interval ?? "-"} · AI: {s.aiInvolvement}
                </div>
              </div>
              <div className="text-right text-sm text-slate-500">
                <div>{counts.get(s.id) ?? 0} 篇</div>
                {s.lastRunAt ? (
                  <div className="text-xs text-slate-400">
                    上次：{new Date(s.lastRunAt).toLocaleDateString("zh-CN")}
                  </div>
                ) : null}
              </div>
            </div>

            {/* URLs + selectors (read only for now) */}
            <div className="mt-3 space-y-1 text-xs text-slate-400">
              <div>
                URLs：{(s.urls as string[]).map((u) => (
                  <code key={u} className="ml-1 rounded bg-slate-50 px-1">
                    {u}
                  </code>
                ))}
              </div>
              {s.listSelector ? (
                <div>
                  选择器：list=<code className="rounded bg-slate-50 px-1">
                    {s.listSelector}
                  </code>{" "}
                  / link=<code className="rounded bg-slate-50 px-1">
                    {s.linkSelector ?? "-"}
                  </code>{" "}
                  / body=
                  <code className="rounded bg-slate-50 px-1">
                    {s.bodySelector ?? "自动"}
                  </code>
                </div>
              ) : null}
              <div>scope：{s.scope ?? "（未设置）"}</div>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
