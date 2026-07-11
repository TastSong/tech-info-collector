import { CheckCircle2, XCircle, Loader2, Globe, FileText } from "lucide-react";

/** 站点颜色 + AI 参与度标签 */
export function badge(label: React.ReactNode, color: "green" | "amber" | "red" | "slate") {
  const map = {
    green: "bg-emerald-50 text-emerald-700",
    amber: "bg-amber-50 text-amber-700",
    red: "bg-red-50 text-red-700",
    slate: "bg-slate-100 text-slate-600",
  };
  return <span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium ${map[color]}`}>{label}</span>;
}

export function statusBadge(s: string) {
  switch (s) {
    case "published": return badge(<><CheckCircle2 className="h-3 w-3" /> 已发布</>, "green");
    case "rejected": return badge(<><XCircle className="h-3 w-3" /> 驳回</>, "red");
    case "analyzing": return badge(<><Loader2 className="h-3 w-3 animate-spin" /> 审核中</>, "slate");
    default: return badge(s, "slate");
  }
}

export function renderBadge(r: string) {
  return r === "dynamic"
    ? badge(<><Globe className="h-3 w-3" /> 动态</>, "amber")
    : badge(<><FileText className="h-3 w-3" /> 静态</>, "slate");
}
