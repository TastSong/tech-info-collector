import Link from "next/link";
import { SiteEditForm } from "../edit-form";
import { ArrowLeft, Globe } from "lucide-react";

export const dynamic = "force-dynamic";

const EMPTY_FORM = {
  name: "",
  category: "",
  subcategory: "",
  urls: [""],
  render: "static" as const,
  listSelector: "",
  itemSelector: "",
  linkSelector: "",
  titleSelector: "",
  bodySelector: "",
  dateSelector: "",
  aiInvolvement: "extract_judge" as const,
  scope: "",
  enabled: false,
};

export default function NewSitePage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <div className="mb-6">
        <Link
          href="/sites"
          className="inline-flex items-center gap-1 text-sm text-indigo-600 hover:text-indigo-800 dark:hover:text-indigo-400 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          返回站点列表
        </Link>
        <h1 className="mt-2 flex items-center gap-2 text-2xl font-bold tracking-tight">
          <Globe className="h-5 w-5 text-indigo-500" />
          新建站点
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          填写表单创建新的采集站点，创建后可在列表页启用
        </p>
      </div>

      <SiteEditForm initial={EMPTY_FORM} mode="create" />
    </main>
  );
}
