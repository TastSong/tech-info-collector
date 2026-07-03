import { db, schema } from "@/db/client";
import { sql } from "drizzle-orm";
import { SiteCard } from "../components/SiteCard";

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
          <SiteCard
            key={s.id}
            site={{
              ...s,
              urls: s.urls as string[],
            }}
            articleCount={counts.get(s.id) ?? 0}
          />
        ))}
      </div>
    </main>
  );
}
