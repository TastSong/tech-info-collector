/** 环形进度图组件 — 用于展示评分 (0-1)。 */
export function ScoreRing({
  score,
  size = 56,
  label,
}: {
  score: number;
  size?: number;
  label?: string;
}) {
  const radius = (size - 6) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - Math.min(Math.max(score, 0), 1));
  const colorClass =
    score >= 0.7
      ? "stroke-emerald-500"
      : score >= 0.4
      ? "stroke-amber-500"
      : "stroke-red-500";
  const pct = Math.round(score * 100);

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative" style={{ width: size, height: size }}>
        <svg
          width={size}
          height={size}
          className="-rotate-90"
          viewBox={`0 0 ${size} ${size}`}
        >
          {/* Background circle */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="currentColor"
            className="text-slate-200"
            strokeWidth="3"
          />
          {/* Progress arc */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            className={`${colorClass} transition-all duration-1000 ease-out`}
            strokeDasharray={circumference}
            strokeDashoffset={offset}
          />
        </svg>
        {/* Center text */}
        <span className="absolute inset-0 flex items-center justify-center text-xs font-bold text-slate-700">
          {pct}
        </span>
      </div>
      {label && (
        <span className="text-[11px] text-slate-400">{label}</span>
      )}
    </div>
  );
}
