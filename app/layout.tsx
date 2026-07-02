import type { Metadata } from "next";
import Link from "next/link";
import { db, schema } from "@/db/client";
import { count, eq } from "drizzle-orm";
import { NavLinks } from "./components/NavLinks";
import "./globals.css";

export const metadata: Metadata = {
  title: "科技情报采集器",
  description: "Node.js 科技情报采集 + AI 审核沙盒",
};

export const dynamic = "force-dynamic";

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
          <div className="relative mx-auto flex max-w-5xl items-center justify-between px-4 sm:px-6 py-3">
            <Link
              href="/"
              className="text-lg font-bold tracking-tight text-slate-900 shrink-0"
            >
              科技情报
            </Link>
            <NavLinks reviewCount={reviewCount} />
          </div>
        </nav>
        {children}
      </body>
    </html>
  );
}
