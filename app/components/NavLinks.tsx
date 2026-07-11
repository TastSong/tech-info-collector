"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, History, LayoutDashboard, Globe, FileText } from "lucide-react";

const NAV_ITEMS = [
  { href: "/", label: "资讯流", icon: Home },
  { href: "/history", label: "历史", icon: History },
  { href: "/dashboard", label: "仪表盘", icon: LayoutDashboard },
  { href: "/sites", label: "站点", icon: Globe },
  { href: "/runs", label: "日志", icon: FileText },
];

function NavLink({
  href,
  children,
  icon: Icon,
  count,
  onClick,
}: {
  href: string;
  children: React.ReactNode;
  icon: React.ElementType;
  count?: number;
  onClick?: () => void;
}) {
  const pathname = usePathname();
  const isActive =
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <Link
      href={href}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors whitespace-nowrap ${
        isActive
          ? "bg-indigo-50 text-indigo-700"
          : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
      }`}
    >
      <Icon className="h-4 w-4" />
      {children}
      {count != null && count > 0 ? (
        <span className="ml-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-700">
          {count}
        </span>
      ) : null}
    </Link>
  );
}

export function NavLinks() {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <>
      {/* Hamburger button — visible on mobile */}
      <button
        onClick={() => setOpen(!open)}
        className="sm:hidden rounded-lg p-2 text-slate-600 hover:bg-slate-100"
        aria-label="Toggle menu"
      >
        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          {open ? (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          ) : (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          )}
        </svg>
      </button>

      {/* Desktop nav — always visible on sm+ */}
      <div className="hidden sm:flex items-center gap-1">
        {NAV_ITEMS.map((item) => (
          <NavLink key={item.href} href={item.href} icon={item.icon}>
            {item.label}
          </NavLink>
        ))}
      </div>

      {/* Mobile dropdown */}
      <div
        className={`absolute top-full left-0 right-0 border-b border-slate-200 bg-white shadow-lg sm:hidden overflow-hidden transition-all duration-300 ease-in-out ${
          open ? "max-h-80 opacity-100" : "max-h-0 opacity-0"
        }`}
      >
        <div className="flex flex-col px-4 py-2">
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.href} href={item.href} icon={item.icon} onClick={close}>
              {item.label}
            </NavLink>
          ))}
        </div>
      </div>
    </>
  );
}
