"use client";

import { useState, useEffect } from "react";
import { SchedulePicker, describeCron } from "./SchedulePicker";
import { Clock, Edit3 } from "lucide-react";

export function ScheduleSection() {
  const [cron, setCron] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [showPicker, setShowPicker] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/settings/schedule");
        if (res.ok) {
          const b = await res.json();
          setCron(b.cron_interval ?? "0 9 * * *");
        }
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  return (
    <section className="mb-10">
      <h2 className="mb-3 text-lg font-semibold dark:text-slate-200">定时采集</h2>
      <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-50 dark:bg-indigo-950">
              <Clock className="h-5 w-5 text-indigo-500" />
            </div>
            <div>
              <div className="text-sm font-medium text-slate-700 dark:text-slate-300">
                {loading ? "加载中…" : describeCron(cron)}
              </div>
              <div className="text-xs text-slate-400 dark:text-slate-500">
                所有启用站点按此频率统一采集
              </div>
            </div>
          </div>
          <button
            type="button"
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 transition-colors dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
            onClick={() => setShowPicker(true)}
          >
            修改
          </button>
        </div>
      </div>

      {showPicker ? (
        <SchedulePicker
          currentCron={cron}
          onSaved={(newCron) => setCron(newCron)}
          onClose={() => setShowPicker(false)}
        />
      ) : null}
    </section>
  );
}
