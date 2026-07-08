"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/* ---------- types ---------- */

export interface SiteFormData {
  name: string;
  category: string;
  subcategory: string;
  urls: string[];
  render: "static" | "dynamic";
  listSelector: string;
  itemSelector: string;
  linkSelector: string;
  titleSelector: string;
  bodySelector: string;
  dateSelector: string;
  aiInvolvement: "none" | "extract" | "extract_judge" | "full";
  scope: string;
  enabled: boolean;
}

const EMPTY_FORM: SiteFormData = {
  name: "",
  category: "",
  subcategory: "",
  urls: [""],
  render: "static",
  listSelector: "",
  itemSelector: "",
  linkSelector: "",
  titleSelector: "",
  bodySelector: "",
  dateSelector: "",
  aiInvolvement: "extract_judge",
  scope: "",
  enabled: false,
};

/* ---------- helpers ---------- */

const cls = {
  section: "rounded-xl border border-slate-200 bg-white p-5 space-y-4",
  sectionTitle: "text-sm font-semibold text-slate-700 border-b border-slate-100 pb-2 mb-3",
  label: "block text-xs font-medium text-slate-600 mb-1",
  input:
    "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 focus:outline-none transition",
  select:
    "rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 bg-white focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 focus:outline-none",
  btn: "inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors cursor-pointer",
  btnPrimary:
    "bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50",
  btnDanger:
    "bg-red-50 text-red-700 hover:bg-red-100",
  btnMuted:
    "bg-slate-100 text-slate-600 hover:bg-slate-200",
};

/* ---------- component ---------- */

export function SiteEditForm({
  initial,
  mode = "edit",
  siteId,
}: {
  initial: SiteFormData;
  mode?: "edit" | "create";
  siteId?: number;
}) {
  const router = useRouter();
  const [form, setForm] = useState<SiteFormData>(initial);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  function update<K extends keyof SiteFormData>(key: K, value: SiteFormData[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setMessage(null);
  }

  function updateUrl(index: number, value: string) {
    setForm((prev) => {
      const urls = [...prev.urls];
      urls[index] = value;
      return { ...prev, urls };
    });
  }

  function addUrl() {
    setForm((prev) => ({ ...prev, urls: [...prev.urls, ""] }));
  }

  function removeUrl(index: number) {
    setForm((prev) => {
      if (prev.urls.length <= 1) return prev;
      return { ...prev, urls: prev.urls.filter((_, i) => i !== index) };
    });
  }

  async function save() {
    setSaving(true);
    setMessage(null);

    try {
      const payload = {
        ...form,
        urls: form.urls.filter((u) => u.trim()),
        category: form.category || null,
        subcategory: form.subcategory || null,
        listSelector: form.listSelector || null,
        itemSelector: form.itemSelector || null,
        linkSelector: form.linkSelector || null,
        titleSelector: form.titleSelector || null,
        bodySelector: form.bodySelector || null,
        dateSelector: form.dateSelector || null,
        scope: form.scope || null,
      };

      const url = mode === "create" ? "/api/sites" : `/api/sites/${siteId}`;
      const method = mode === "create" ? "POST" : "PATCH";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        setMessage({ type: "error", text: data.error ?? "保存失败" });
        return;
      }

      setMessage({ type: "success", text: "保存成功" });

      if (mode === "create" && data.id) {
        router.push(`/sites/${data.id}`);
      } else {
        router.refresh();
      }
    } catch {
      setMessage({ type: "error", text: "网络错误，保存失败" });
    } finally {
      setSaving(false);
    }
  }

  async function deleteSite() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/sites/${siteId}`, { method: "DELETE" });
      const data = await res.json();

      if (!res.ok) {
        setMessage({ type: "error", text: data.error ?? "删除失败" });
        return;
      }

      router.push("/sites");
    } catch {
      setMessage({ type: "error", text: "网络错误，删除失败" });
    } finally {
      setDeleting(false);
    }
  }

  /* ---------- render ---------- */

  return (
    <div className="space-y-6">
      {/* toast */}
      {message && (
        <div
          className={`rounded-lg px-4 py-3 text-sm font-medium ${
            message.type === "success"
              ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
              : "bg-red-50 text-red-700 border border-red-200"
          }`}
        >
          {message.text}
        </div>
      )}

      {/* ---- 基础信息 ---- */}
      <section className={cls.section}>
        <h2 className={cls.sectionTitle}>基础信息</h2>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className={cls.label}>站点名称 *</label>
            <input
              className={cls.input}
              value={form.name}
              onChange={(e) => update("name", e.target.value)}
              placeholder="例：科学技术部"
            />
          </div>
          <div>
            <label className={cls.label}>分类</label>
            <input
              className={cls.input}
              value={form.category}
              onChange={(e) => update("category", e.target.value)}
              placeholder="例：国家级科技部门"
            />
          </div>
          <div>
            <label className={cls.label}>子分类</label>
            <input
              className={cls.input}
              value={form.subcategory}
              onChange={(e) => update("subcategory", e.target.value)}
              placeholder="例：市级"
            />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className={cls.label}>渲染模式</label>
            <select
              className={cls.select + " w-full"}
              value={form.render}
              onChange={(e) => update("render", e.target.value as "static" | "dynamic")}
            >
              <option value="static">static (静态)</option>
              <option value="dynamic">dynamic (动态)</option>
            </select>
          </div>
          <div>
            <label className={cls.label}>AI 参与度</label>
            <select
              className={cls.select + " w-full"}
              value={form.aiInvolvement}
              onChange={(e) =>
                update("aiInvolvement", e.target.value as SiteFormData["aiInvolvement"])
              }
            >
              <option value="none">none (跳过)</option>
              <option value="extract">extract (提取)</option>
              <option value="extract_judge">extract_judge (提取+判定)</option>
              <option value="full">full (完全)</option>
            </select>
          </div>
          <div>
            <label className={cls.label}>启用</label>
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                onClick={() => update("enabled", !form.enabled)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer ${
                  form.enabled ? "bg-emerald-500" : "bg-slate-300"
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
                    form.enabled ? "translate-x-6" : "translate-x-1"
                  }`}
                />
              </button>
              <span className="text-sm text-slate-500">{form.enabled ? "启用" : "禁用"}</span>
            </div>
          </div>
        </div>

        <div>
          <label className={cls.label}>Scope（AI 关注范围）</label>
          <textarea
            className={cls.input}
            rows={2}
            value={form.scope}
            onChange={(e) => update("scope", e.target.value)}
            placeholder="该站点关注什么内容，作为 AI 审核的 scope 输入"
          />
        </div>
      </section>

      {/* ---- URLs ---- */}
      <section className={cls.section}>
        <div className="flex items-center justify-between border-b border-slate-100 pb-2 mb-3">
          <h2 className="text-sm font-semibold text-slate-700">URLs</h2>
          <button type="button" onClick={addUrl} className={cls.btn + " " + cls.btnMuted + " text-xs"}>
            + 添加
          </button>
        </div>

        <div className="space-y-2">
          {form.urls.map((url, i) => (
            <div key={i} className="flex gap-2">
              <input
                className={cls.input + " flex-1 font-mono text-xs"}
                value={url}
                onChange={(e) => updateUrl(i, e.target.value)}
                placeholder="https://example.com/page"
              />
              <button
                type="button"
                onClick={() => removeUrl(i)}
                disabled={form.urls.length <= 1}
                className="shrink-0 rounded-lg px-2 py-1 text-xs text-red-500 hover:bg-red-50 disabled:opacity-30 cursor-pointer"
                title="删除此 URL"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* ---- CSS 选择器 ---- */}
      <section className={cls.section}>
        <h2 className={cls.sectionTitle}>CSS 选择器</h2>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={cls.label}>listSelector (列表容器)</label>
            <input
              className={cls.input + " font-mono text-xs"}
              value={form.listSelector}
              onChange={(e) => update("listSelector", e.target.value)}
              placeholder="ul.news_list"
            />
          </div>
          <div>
            <label className={cls.label}>itemSelector (条目)</label>
            <input
              className={cls.input + " font-mono text-xs"}
              value={form.itemSelector}
              onChange={(e) => update("itemSelector", e.target.value)}
              placeholder="li"
            />
          </div>
          <div>
            <label className={cls.label}>linkSelector (链接)</label>
            <input
              className={cls.input + " font-mono text-xs"}
              value={form.linkSelector}
              onChange={(e) => update("linkSelector", e.target.value)}
              placeholder="a"
            />
          </div>
          <div>
            <label className={cls.label}>titleSelector (标题)</label>
            <input
              className={cls.input + " font-mono text-xs"}
              value={form.titleSelector}
              onChange={(e) => update("titleSelector", e.target.value)}
              placeholder="h1.title"
            />
          </div>
          <div>
            <label className={cls.label}>bodySelector (正文)</label>
            <input
              className={cls.input + " font-mono text-xs"}
              value={form.bodySelector}
              onChange={(e) => update("bodySelector", e.target.value)}
              placeholder="div.content"
            />
          </div>
          <div>
            <label className={cls.label}>dateSelector (日期)</label>
            <input
              className={cls.input + " font-mono text-xs"}
              value={form.dateSelector}
              onChange={(e) => update("dateSelector", e.target.value)}
              placeholder="time.pub-date"
            />
          </div>
        </div>
      </section>

      {/* ---- 操作按钮 ---- */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex gap-3">
          <button
            type="button"
            onClick={save}
            disabled={saving || !form.name.trim()}
            className={cls.btn + " " + cls.btnPrimary}
          >
            {saving ? "保存中…" : "保存"}
          </button>
          <button
            type="button"
            onClick={() => router.back()}
            className={cls.btn + " " + cls.btnMuted}
          >
            取消
          </button>
        </div>

        {mode === "edit" && (
          <div>
            {showDeleteConfirm ? (
              <span className="flex items-center gap-2 text-sm text-red-600">
                确认删除此站点？
                <button
                  type="button"
                  onClick={deleteSite}
                  disabled={deleting}
                  className="rounded bg-red-600 px-3 py-1 text-xs text-white hover:bg-red-700 cursor-pointer"
                >
                  {deleting ? "删除中…" : "确认"}
                </button>
                <button
                  type="button"
                  onClick={() => setShowDeleteConfirm(false)}
                  className="rounded bg-slate-100 px-3 py-1 text-xs text-slate-600 hover:bg-slate-200 cursor-pointer"
                >
                  取消
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(true)}
                className={cls.btn + " " + cls.btnDanger}
              >
                删除站点
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
