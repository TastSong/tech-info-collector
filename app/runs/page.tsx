import { db, schema } from "@/db/client";
import { desc } from "drizzle-orm";
import { RunsTable } from "./RunsTable";

export const dynamic = "force-dynamic";

export default function RunsPage() {
  const logs = db
    .select()
    .from(schema.runLogs)
    .orderBy(desc(schema.runLogs.startedAt))
    .limit(50)
    .all()
    .map((r) => ({
      ...r,
      crawlSessionId: r.crawlSessionId,
      startedAt: r.startedAt?.toISOString() ?? null,
      endedAt: r.endedAt?.toISOString() ?? null,
    }));

  // 加载所有 crawl sessions 用于显示 session 编号
  const sessions = db.select().from(schema.crawlSessions).all();
  const sessionMap = Object.fromEntries(
    sessions.map((s) => [s.id, s]),
  );

  const sites = db.select().from(schema.sites).all();
  const siteNames = Object.fromEntries(sites.map((s) => [s.id, s.name]));

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <h1 className="mb-6 text-2xl font-bold tracking-tight">运行日志</h1>
      <RunsTable initialLogs={logs} siteNames={siteNames} sessionMap={sessionMap} />
    </main>
  );
}
