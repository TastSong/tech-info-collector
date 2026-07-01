/** 可复用的仪表盘统计卡片。 */
export function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: number | string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="text-2xl font-semibold text-slate-900">{value}</div>
      <div className="mt-1 flex items-center gap-2">
        <span className="text-sm text-slate-500">{label}</span>
        {hint ? (
          <span className="text-xs text-slate-400">{hint}</span>
        ) : null}
      </div>
    </div>
  );
}
