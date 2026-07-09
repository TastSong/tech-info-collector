import { db, schema } from "@/db/client";
import { desc, sql } from "drizzle-orm";
import { RunsTable } from "./RunsTable";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 30;

export default function RunsPage() {
  const totalRow = db
    .select({ c: sql<number>`COUNT(*)` })
    .from(schema.runLogs)
    .get();
  const total = totalRow?.c ?? 0;

  const logs = db
    .select()
    .from(schema.runLogs)
    .orderBy(desc(schema.runLogs.startedAt))
    .limit(PAGE_SIZE)
    .all()
    .map((r) => ({
      ...r,
      crawlSessionId: r.crawlSessionId,
      startedAt: r.startedAt?.toISOString() ?? null,
      endedAt: r.endedAt?.toISOString() ?? null,
    }));

  // 站点名映射
  const sites = db.select().from(schema.sites).all();
  const siteNames: Record<number, string> = {};
  for (const s of sites) {
    siteNames[s.id] = s.name;
  }

  // crawl sessions 映射
  const sessions = db.select().from(schema.crawlSessions).all();
  const sessionMap: Record<number, { id: number; startedAt: string | null }> = {};
  for (const s of sessions) {
    sessionMap[s.id] = {
      id: s.id,
      startedAt: s.startedAt?.toISOString() ?? null,
    };
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <h1 className="mb-6 text-2xl font-bold tracking-tight">运行日志</h1>
      <RunsTable
        initialLogs={logs}
        siteNames={siteNames}
        sessionMap={sessionMap}
        total={total}
      />
    </main>
  );
}
