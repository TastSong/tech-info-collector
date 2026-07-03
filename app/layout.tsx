import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { db, schema } from "@/db/client";
import { count, eq } from "drizzle-orm";
import { verifySignedToken } from "@/src/lib/password";
import { NavLinks } from "./components/NavLinks";
import { UserMenu } from "./components/UserMenu";
import "./globals.css";

export const metadata: Metadata = {
  title: "科技情报采集器",
  description: "Node.js 科技情报采集 + AI 审核沙盒",
};

export const dynamic = "force-dynamic";

/** Verify auth cookie and return current user (id + username), or null. */
async function getCurrentUser(): Promise<{ id: number; username: string } | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get("auth_token")?.value;
  if (!token) return null;

  const payload = verifySignedToken(token);
  if (!payload) return null;

  // Confirm the user still exists in DB
  const user = db.select({ id: schema.users.id, username: schema.users.username })
    .from(schema.users)
    .where(eq(schema.users.id, payload.u))
    .get();

  return user ?? null;
}

export default async function RootLayout({
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

  const currentUser = await getCurrentUser();

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
            <div className="flex items-center gap-3">
              <NavLinks reviewCount={reviewCount} />
              {currentUser && <UserMenu username={currentUser.username} />}
            </div>
          </div>
        </nav>
        {children}
      </body>
    </html>
  );
}
