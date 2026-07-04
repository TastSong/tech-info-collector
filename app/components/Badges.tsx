/** 站点颜色 + AI 参与度标签 */
export function badge(label: string, color: "green" | "amber" | "red" | "slate") {
  const map = {
    green: "bg-emerald-50 text-emerald-700",
    amber: "bg-amber-50 text-amber-700",
    red: "bg-red-50 text-red-700",
    slate: "bg-slate-100 text-slate-600",
  };
  return <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${map[color]}`}>{label}</span>;
}

export function statusBadge(s: string) {
  switch (s) {
    case "published": return badge("✓ 已发布", "green");
    case "rejected": return badge("✗ 驳回", "red");
    case "analyzing": return badge("⊗ 审核中", "slate");
    default: return badge(s, "slate");
  }
}

export function renderBadge(r: string) {
  return r === "dynamic" ? badge("动态", "amber") : badge("静态", "slate");
}
