import type { Metadata } from "next";
import Link from "next/link";
import { db, schema } from "@/db/client";
import { count, eq } from "drizzle-orm";
import "./globals.css";

export const metadata: Metadata = {
  title: "科技情报采集器",
  description: "Node.js 科技情报采集 + AI 审核沙盒",
};

function NavLink({
  href,
  children,
  count,
}: {
  href: string;
  children: React.ReactNode;
  count?: number;
}) {
  return (
    <Link
      href={href}
      className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors"
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

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const reviewCount =
    db
      .select({ v: count() })
      .from(schema.articles)
      .where(eq(schema.articles.status, "review"))
      .get()?.v ?? 0;

  return (
    <html lang="zh-CN">
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased">
        <nav className="sticky top-0 z-10 border-b border-slate-200 bg-white/80 backdrop-blur">
          <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
            <Link
              href="/"
              className="text-lg font-bold tracking-tight text-slate-900"
            >
              科技情报采集器
            </Link>
            <div className="flex items-center gap-1">
              <NavLink href="/">首页</NavLink>
              <NavLink href="/feed">资讯流</NavLink>
              <NavLink href="/articles">文章</NavLink>
              <NavLink href="/review" count={reviewCount}>
                待复核
              </NavLink>
              <NavLink href="/sites">站点</NavLink>
              <NavLink href="/runs">日志</NavLink>
            </div>
          </div>
        </nav>
        {children}
      </body>
    </html>
  );
}
