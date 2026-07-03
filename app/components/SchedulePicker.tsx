"use client";

import { useState, useEffect } from "react";

/** 频率预设 */
type Preset = "never" | "monthly" | "weekly" | "daily";

const DOW_LABELS: [number, string][] = [
  [1, "周一"],
  [2, "周二"],
  [3, "周三"],
  [4, "周四"],
  [5, "周五"],
  [6, "周六"],
  [0, "周日"],
];

function presetFromCron(expr: string): Preset {
  if (!expr) return "never";
  const f = expr.trim().split(/\s+/);
  if (f.length !== 5) return "daily"; // 兜底

  const min = f[0];
  const hour = f[1];
  const dom = f[2];
  const month = f[3];
  const dow = f[4];

  if (min.includes("/") || hour.includes("/")) return "daily";
  if (month !== "*") return "daily";
  if (dom === "*" && dow === "*") return "daily";
  if (dom !== "*" && dow === "*") return "monthly";
  if (dom === "*" && dow !== "*") return "weekly";

  return "daily";
}

function timeFromCron(expr: string) {
  const f = expr.trim().split(/\s+/);
  if (f.length !== 5) return { hour: "09", min: "00" };
  const h = Number(f[1]);
  const m = Number(f[0]);
  return {
    hour: isNaN(h) || h < 0 || h > 23 ? "09" : String(h).padStart(2, "0"),
    min: isNaN(m) || m < 0 || m > 59 ? "00" : String(m).padStart(2, "0"),
  };
}

function dowsFromCron(expr: string): number[] {
  const f = expr.trim().split(/\s+/);
  if (f.length !== 5) return [];
  if (f[4] === "*") return [];
  return f[4].split(",").map(Number).filter((n) => !isNaN(n));
}

function domFromCron(expr: string): string {
  const f = expr.trim().split(/\s+/);
  if (f.length !== 5) return "1";
  if (f[2] !== "*") return f[2];
  return "1";
}

function buildCron(
  preset: Preset,
  hour: string,
  min: string,
  dows: number[],
  dom: string,
): string {
  if (preset === "daily") return `${Number(min)} ${Number(hour)} * * *`;
  if (preset === "weekly")
    return `${Number(min)} ${Number(hour)} * * ${dows.sort().join(",")}`;
  if (preset === "monthly")
    return `${Number(min)} ${Number(hour)} ${Number(dom)} * *`;
  return `${Number(min)} ${Number(hour)} * * *`;
}

export function describeCron(expr: string | null): string {
  if (!expr) return "未设置";
  const preset = presetFromCron(expr);
  const { hour, min } = timeFromCron(expr);
  const timeStr = `${hour}:${min}`;

  switch (preset) {
    case "daily":
      return `每天 ${timeStr}`;
    case "weekly": {
      const dows = dowsFromCron(expr);
      const names = dows
        .map((d) => DOW_LABELS.find(([n]) => n === d)?.[1] ?? d)
        .join("、");
      return `每${names} ${timeStr}`;
    }
    case "monthly": {
      const d = domFromCron(expr);
      return `每月${Number(d)}号 ${timeStr}`;
    }
    default:
      return `${expr}`;
  }
}

interface Props {
  currentCron: string;
  onSaved: (cron: string) => void;
  onClose: () => void;
}

export function SchedulePicker({ currentCron, onSaved, onClose }: Props) {
  const expr = currentCron || "0 9 * * *";
  const [preset, setPreset] = useState<Preset>(presetFromCron(expr));
  const { hour: defH, min: defM } = timeFromCron(expr);
  const [hour, setHour] = useState(defH);
  const [min, setMin] = useState(defM);
  const [dows, setDows] = useState<number[]>(dowsFromCron(expr));
  const [dom, setDom] = useState(domFromCron(expr));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const cronPreview = buildCron(preset, hour, min, dows, dom);

  function toggleDow(d: number) {
    setDows((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d],
    );
  }

  async function save() {
    if (preset === "weekly" && dows.length === 0) {
      setError("请至少选择一个星期");
      return;
    }

    setError("");
    setSaving(true);
    try {
      const res = await fetch("/api/settings/schedule", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cron_interval: cronPreview }),
      });
      if (!res.ok) {
        const b = await res.json();
        setError(b.error ?? "保存失败");
        return;
      }
      onSaved(cronPreview);
      onClose();
    } catch {
      setError("网络错误");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
        <h3 className="mb-4 text-lg font-semibold text-slate-900">
          定时采集设置
        </h3>

        {/* 频率预设 */}
        <div className="mb-4">
          <label className="mb-1.5 block text-xs font-medium text-slate-500">
            频率
          </label>
          <select
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            value={preset}
            onChange={(e) => {
              setPreset(e.target.value as Preset);
              setError("");
            }}
          >
            <option value="monthly">每月</option>
            <option value="weekly">每周</option>
            <option value="daily">每天</option>
          </select>
        </div>

        {/* 时间选择 */}
        <div className="mb-4 flex gap-3">
          <div className="flex-1">
            <label className="mb-1.5 block text-xs font-medium text-slate-500">
              时
            </label>
            <select
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              value={hour}
              onChange={(e) => setHour(e.target.value)}
            >
              {Array.from({ length: 24 }, (_, i) => (
                <option key={i} value={String(i).padStart(2, "0")}>
                  {String(i).padStart(2, "0")}
                </option>
              ))}
            </select>
          </div>
          <div className="flex-1">
            <label className="mb-1.5 block text-xs font-medium text-slate-500">
              分
            </label>
            <select
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              value={min}
              onChange={(e) => setMin(e.target.value)}
            >
              {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map((m) => (
                <option key={m} value={String(m).padStart(2, "0")}>
                  {String(m).padStart(2, "0")}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* 每月：日期选择 */}
        {preset === "monthly" && (
          <div className="mb-4">
            <label className="mb-1.5 block text-xs font-medium text-slate-500">
              每月几号
            </label>
            <select
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              value={dom}
              onChange={(e) => setDom(e.target.value)}
            >
              {Array.from({ length: 28 }, (_, i) => (
                <option key={i + 1} value={String(i + 1)}>
                  {i + 1}号
                </option>
              ))}
            </select>
          </div>
        )}

        {/* 每周：星期多选 */}
        {preset === "weekly" && (
          <div className="mb-4">
            <label className="mb-1.5 block text-xs font-medium text-slate-500">
              星期
            </label>
            <div className="flex flex-wrap gap-2">
              {DOW_LABELS.map(([n, label]) => (
                <button
                  key={n}
                  type="button"
                  className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                    dows.includes(n)
                      ? "bg-indigo-500 text-white"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                  onClick={() => toggleDow(n)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Cron 预览 */}
        <div className="mb-4 rounded-lg bg-slate-50 px-3 py-2">
          <span className="text-xs text-slate-400">cron: </span>
          <code className="text-xs text-slate-700">{cronPreview}</code>
        </div>

        {error ? (
          <p className="mb-3 text-xs text-red-500">{error}</p>
        ) : null}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
            onClick={onClose}
          >
            取消
          </button>
          <button
            type="button"
            className="rounded-lg bg-slate-800 px-4 py-2 text-sm text-white hover:bg-slate-900 disabled:opacity-50"
            onClick={save}
            disabled={saving}
          >
            {saving ? "保存中…" : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}
