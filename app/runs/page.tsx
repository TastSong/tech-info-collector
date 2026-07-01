import { db, schema } from "@/db/client";
import { desc, eq } from "drizzle-orm";

export default async function RunsPage() {
  const logs = db
    .select()
    .from(schema.runLogs)
    .orderBy(desc(schema.runLogs.startedAt))
    .limit(50)
    .all();

  const sites = db.select().from(schema.sites).all();
  const nameOf = new Map(sites.map((s) => [s.id, s.name]));

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <h1 className="mb-6 text-2xl font-bold tracking-tight">运行日志</h1>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">开始时间</th>
              <th className="px-4 py-3">站点</th>
              <th className="px-4 py-3">采集</th>
              <th className="px-4 py-3">跳过</th>
              <th className="px-4 py-3">错误</th>
              <th className="px-4 py-3">状态</th>
              <th className="px-4 py-3">说明</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {logs.map((r) => (
              <tr key={r.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 text-slate-500">
                  {r.startedAt
                    ? new Date(r.startedAt).toLocaleString("zh-CN")
                    : "-"}
                </td>
                <td className="px-4 py-3 font-medium">
                  {nameOf.get(r.siteId ?? 0) ?? `#${r.siteId}`}
                </td>
                <td className="px-4 py-3 text-emerald-600">{r.fetched}</td>
                <td className="px-4 py-3 text-slate-400">{r.skipped}</td>
                <td className="px-4 py-3 text-red-500">
                  {r.errorCount > 0 ? r.errorCount : "-"}
                </td>
                <td className="px-4 py-3">
                  {r.status === "success"
                    ? <span className="text-xs font-medium text-emerald-600">成功</span>
                    : r.status === "partial"
                    ? <span className="text-xs font-medium text-amber-600">部分</span>
                    : r.status === "error"
                    ? <span className="text-xs font-medium text-red-600">失败</span>
                    : <span className="text-xs text-slate-400">{r.status}</span>}
                </td>
                <td className="px-4 py-3 max-w-[200px] truncate text-xs text-slate-400">
                  {r.message ?? "-"}
                </td>
              </tr>
            ))}
            {!logs.length ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                  暂无运行记录
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </main>
  );
}
