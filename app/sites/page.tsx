import Link from "next/link";
import { db, schema } from "@/db/client";
import { sql } from "drizzle-orm";
import { SitesList } from "./SitesList";

export const dynamic = "force-dynamic";

export default async function SitesPage() {
  const sites = db.select().from(schema.sites).all();

  // site article counts → plain object for client component
  const countsArr = db
    .select({
      siteId: schema.articles.siteId,
      c: sql<number>`COUNT(*)`,
    })
    .from(schema.articles)
    .groupBy(schema.articles.siteId)
    .all();

  const counts: Record<number, number> = {};
  for (const r of countsArr) {
    counts[r.siteId] = r.c;
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">站点配置</h1>
          <p className="mt-1 text-sm text-slate-500">
            {sites.filter((s) => s.enabled).length} / {sites.length} 启用
          </p>
        </div>
        <Link
          href="/sites/new"
          className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition-colors"
        >
          + 新建站点
        </Link>
      </div>

      <SitesList
        sites={sites.map((s) => ({
          ...s,
          urls: s.urls as string[],
        }))}
        articleCounts={counts}
      />
    </main>
  );
}
