import { db, schema } from "@/db/client";
import { desc } from "drizzle-orm";
import { RunsTable } from "./RunsTable";

export default function RunsPage() {
  const logs = db
    .select()
    .from(schema.runLogs)
    .orderBy(desc(schema.runLogs.startedAt))
    .limit(50)
    .all()
    .map((r) => ({
      ...r,
      startedAt: r.startedAt?.toISOString() ?? null,
      endedAt: r.endedAt?.toISOString() ?? null,
    }));

  const sites = db.select().from(schema.sites).all();
  const siteNames = Object.fromEntries(sites.map((s) => [s.id, s.name]));

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <h1 className="mb-6 text-2xl font-bold tracking-tight">运行日志</h1>
      <RunsTable initialLogs={logs} siteNames={siteNames} />
    </main>
  );
}
