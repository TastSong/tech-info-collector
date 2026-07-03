import Link from "next/link";
import { db, schema } from "@/db/client";
import { count, eq, sql } from "drizzle-orm";
import { Stat } from "./components/Stat";
import { CrawlTrigger } from "./components/ActionButtons";
import { statusBadge, renderBadge } from "./components/Badges";
import { LiveProgress } from "./components/LiveProgress";
import { ScheduleSection } from "./components/ScheduleSection";

export const dynamic = "force-dynamic";

export default function Home() {
  const articles = db.select().from(schema.articles).all();
  const total = articles.length;
  const readyCount = articles.filter((a) => a.status === "ready" || a.status === "published").length;
  const reviewCount = articles.filter((a) => a.status === "review").length;
  const rejectedCount = articles.filter((a) => a.status === "rejected").length;

  // 最近 5 次 crawl session
  const sessions = db
    .select()
    .from(schema.crawlSessions)
    .orderBy(sql`id DESC`)
    .limit(5)
    .all();

  // 各站点文章统计
  const siteStats = db
    .select({
      id: schema.sites.id,
      name: schema.sites.name,
      render: schema.sites.render,
      enabled: schema.sites.enabled,
      aiInvolvement: schema.sites.aiInvolvement,
      total: count(schema.articles.id),
    })
    .from(schema.sites)
    .leftJoin(schema.articles, eq(schema.sites.id, schema.articles.siteId))
    .groupBy(schema.sites.id)
    .all();

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      {/* Header */}
      <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">仪表盘</h1>
          <p className="mt-1 text-sm text-slate-500">
            {total} 篇文章 · {readyCount} 可用 · {reviewCount} 待复核 ·{" "}
            {rejectedCount} 已驳回
          </p>
        </div>
        <CrawlTrigger />
      </div>

      {/* Stats */}
      <section className="mb-10 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-2xl font-semibold text-slate-900">{total}</div>
          <div className="mt-1 text-sm text-slate-500">总文章</div>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <div className="text-2xl font-semibold text-emerald-700">
            {readyCount}
          </div>
          <div className="mt-1 text-sm text-emerald-600">可用情报</div>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <div className="text-2xl font-semibold text-amber-700">
            {reviewCount}
          </div>
          <div className="mt-1 text-sm text-amber-600">
            <Link href="/review" className="hover:underline">
              待人工复核 →{" "}
            </Link>
          </div>
        </div>
        <div className="rounded-xl border border-red-200 bg-red-50 p-4">
          <div className="text-2xl font-semibold text-red-700">
            {rejectedCount}
          </div>
          <div className="mt-1 text-sm text-red-600">AI 已筛除</div>
        </div>
      </section>

      {/* Live Progress */}
      <LiveProgress />

      {/* Schedule */}
      <ScheduleSection />

      {/* Recent Runs */}
      <section className="mb-10">
        <h2 className="mb-3 text-lg font-semibold">最近采集</h2>
        {sessions.length ? (
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">时间</th>
                  <th className="px-4 py-3">站点数</th>
                  <th className="px-4 py-3">新采</th>
                  <th className="px-4 py-3">更新</th>
                  <th className="px-4 py-3">跳过</th>
                  <th className="px-4 py-3">错误</th>
                  <th className="px-4 py-3">结果</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sessions.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 text-slate-500">
                      {s.startedAt
                        ? new Date(s.startedAt).toLocaleString("zh-CN", {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : "-"}
                    </td>
                    <td className="px-4 py-3 font-medium">
                      {s.status === "running" ? (
                        <span className="flex items-center gap-1.5">
                          <span className="inline-flex h-2 w-2 rounded-full bg-indigo-500 animate-pulse" />
                          {s.siteCount} 站
                        </span>
                      ) : (
                        <span>{s.siteCount} 站</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-emerald-600">{s.totalFetched > 0 ? s.totalFetched : "-"}</td>
                    <td className="px-4 py-3 text-indigo-600">{s.totalUpdated > 0 ? s.totalUpdated : "-"}</td>
                    <td className="px-4 py-3 text-slate-400">{s.totalSkipped > 0 ? s.totalSkipped : "-"}</td>
                    <td className="px-4 py-3 text-red-500">
                      {s.totalErrors > 0 ? s.totalErrors : "-"}
                    </td>
                    <td className="px-4 py-3">
                      {s.status === "success"
                        ? <span className="text-xs font-medium text-emerald-600">成功</span>
                        : s.status === "partial"
                        ? <span className="text-xs font-medium text-amber-600">部分</span>
                        : s.status === "running"
                        ? <span className="text-xs font-medium text-indigo-600">采集中</span>
                        : s.status === "aborted"
                        ? <span className="text-xs font-medium text-slate-500">已中止</span>
                        : <span className="text-xs font-medium text-red-600">失败</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-slate-400">暂无采集记录</p>
        )}
      </section>

      {/* Site Overview */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">站点概况</h2>
          <Link
            href="/sites"
            className="text-sm font-medium text-indigo-600 hover:text-indigo-800"
          >
            管理站点 →
          </Link>
        </div>
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">站点</th>
                <th className="px-4 py-3">分类</th>
                <th className="px-4 py-3">类型</th>
                <th className="px-4 py-3">AI</th>
                <th className="px-4 py-3">文章</th>
                <th className="px-4 py-3">状态</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {siteStats.map((s) => (
                <tr key={s.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-900">
                    <Link
                      href={`/articles?site=${s.id}`}
                      className="hover:text-indigo-600"
                    >
                      {s.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-slate-500 text-xs">
                    {s.aiInvolvement}
                  </td>
                  <td className="px-4 py-3">{renderBadge(s.render ?? "")}</td>
                  <td className="px-4 py-3 text-xs text-slate-500">
                    {s.aiInvolvement}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{s.total}</td>
                  <td className="px-4 py-3">
                    {s.enabled ? (
                      <span className="text-xs font-medium text-emerald-600">
                        启用
                      </span>
                    ) : (
                      <span className="text-xs text-slate-400">禁用</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
