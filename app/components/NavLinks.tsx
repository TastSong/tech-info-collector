"use client";

import { useState } from "react";
import Link from "next/link";

function NavLink({
  href,
  children,
  count,
  onClick,
}: {
  href: string;
  children: React.ReactNode;
  count?: number;
  onClick?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors whitespace-nowrap"
    >
      {children}
      {count != null && count > 0 ? (
        <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-xs text-amber-700">
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
        <NavLink href="/">首页</NavLink>
        <NavLink href="/feed">资讯流</NavLink>
        <NavLink href="/history">历史</NavLink>
        <NavLink href="/articles">文章</NavLink>
        <NavLink href="/sites">站点</NavLink>
        <NavLink href="/runs">日志</NavLink>
      </div>

      {/* Mobile dropdown */}
      {open && (
        <div className="absolute top-full left-0 right-0 border-b border-slate-200 bg-white shadow-lg sm:hidden">
          <div className="flex flex-col px-4 py-2">
            <NavLink href="/" onClick={close}>首页</NavLink>
            <NavLink href="/feed" onClick={close}>资讯流</NavLink>
            <NavLink href="/history" onClick={close}>历史</NavLink>
            <NavLink href="/articles" onClick={close}>文章</NavLink>
            <NavLink href="/sites" onClick={close}>站点</NavLink>
            <NavLink href="/runs" onClick={close}>日志</NavLink>
          </div>
        </div>
      )}
    </>
  );
}
