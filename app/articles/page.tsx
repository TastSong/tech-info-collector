import Link from "next/link";
import { db, schema } from "@/db/client";
import { eq, desc, sql } from "drizzle-orm";
import { statusBadge } from "../components/Badges";

export const dynamic = "force-dynamic";

export default async function ArticlesPage(props: {
  searchParams: Promise<{ site?: string; status?: string }>;
}) {
  const sp = await props.searchParams;
  const siteId = sp.site ? Number(sp.site) : undefined;
  const status = sp.status || undefined;

  const conditions = [sql`1=1`];
  if (siteId) conditions.push(eq(schema.articles.siteId, siteId));
  if (status) conditions.push(eq(schema.articles.status, status as any));

  const articles = db
    .select()
    .from(schema.articles)
    .where(sql.join(conditions, " AND "))
    .orderBy(desc(schema.articles.fetchedAt))
    .limit(60)
    .all();

  // 站点名映射
  const sites = db.select().from(schema.sites).all();
  const nameOf = new Map(sites.map((s) => [s.id, s.name]));
  const statuses = [
    "raw",
    "analyzing",
    "published",
    "rejected",
  ];

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <h1 className="mb-6 text-2xl font-bold tracking-tight">文章流</h1>

      {/* Filters */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        {statuses.map((s) => (
          <Link
            key={s}
            href={`/articles?status=${s}${siteId ? `&site=${siteId}` : ""}`}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              status === s
                ? "bg-slate-800 text-white"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            {s === "published"
              ? "已发布"
              : s === "rejected"
              ? "已驳回"
              : s === "analyzing"
              ? "审核中"
              : "原始"}
          </Link>
        ))}
        {siteId ? (
          <span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-600">
            站点 #{siteId}
            <Link href="/articles" className="ml-1 hover:underline">
              ✕
            </Link>
          </span>
        ) : null}
      </div>

      {/* List */}
      <div className="space-y-3">
        {articles.map((a) => (
          <Link
            key={a.id}
            href={`/articles/${a.id}`}
            className="block rounded-xl border border-slate-200 bg-white p-4 hover:border-indigo-300 transition-colors"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="font-medium text-slate-900 line-clamp-1">
                  {a.title || "(无标题)"}
                </div>
                <div className="mt-1 flex items-center gap-2 text-xs text-slate-400">
                  <span>{nameOf.get(a.siteId) ?? `#${a.siteId}`}</span>
                  <span>·</span>
                  <span>
                    {a.publishedAt
                      ? new Date(a.publishedAt).toLocaleDateString("zh-CN")
                      : a.fetchedAt
                      ? new Date(a.fetchedAt).toLocaleDateString("zh-CN")
                      : "-"}
                  </span>
                </div>
              </div>
              <div className="shrink-0">{statusBadge(a.status)}</div>
            </div>
          </Link>
        ))}
        {!articles.length ? (
          <p className="text-sm text-slate-400">暂无匹配文章</p>
        ) : null}
      </div>
    </main>
  );
}
