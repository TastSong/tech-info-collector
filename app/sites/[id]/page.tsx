import { db, schema } from "@/db/client";
import { eq } from "drizzle-orm";
import Link from "next/link";
import { SiteEditForm, type SiteFormData } from "../edit-form";

export const dynamic = "force-dynamic";

function notFound() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-10 text-center">
      <h1 className="text-xl font-bold text-slate-800">站点不存在</h1>
      <p className="mt-2 text-sm text-slate-500">
        请检查站点 ID 是否正确
      </p>
      <Link
        href="/sites"
        className="mt-6 inline-block rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
      >
        ← 返回站点列表
      </Link>
    </main>
  );
}

export default async function SiteEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const row = db
    .select()
    .from(schema.sites)
    .where(eq(schema.sites.id, Number(id)))
    .get();

  if (!row) return notFound();

  const initial: SiteFormData = {
    name: row.name,
    category: row.category ?? "",
    subcategory: row.subcategory ?? "",
    urls: (row.urls as string[]).length ? (row.urls as string[]) : [""],
    render: row.render as "static" | "dynamic",
    listSelector: row.listSelector ?? "",
    itemSelector: row.itemSelector ?? "",
    linkSelector: row.linkSelector ?? "",
    titleSelector: row.titleSelector ?? "",
    bodySelector: row.bodySelector ?? "",
    dateSelector: row.dateSelector ?? "",
    aiInvolvement: row.aiInvolvement as SiteFormData["aiInvolvement"],
    scope: row.scope ?? "",
    enabled: !!row.enabled,
  };

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <div className="mb-6">
        <Link
          href="/sites"
          className="text-sm text-indigo-600 hover:text-indigo-800"
        >
          ← 返回站点列表
        </Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">编辑站点</h1>
        <p className="mt-1 text-sm text-slate-500">#{row.id} — {row.name}</p>
      </div>

      <SiteEditForm initial={initial} mode="edit" siteId={row.id} />
    </main>
  );
}
