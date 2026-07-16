import type { Metadata } from "next";
import Link from "next/link";
import { getCurrentUser } from "@/src/lib/auth";
import { NavLinks } from "./components/NavLinks";
import { UserMenu } from "./components/UserMenu";
import { ThemeToggle } from "./components/ThemeToggle";
import { ThemeProvider } from "./components/ThemeProvider";
import { ToastProvider } from "./components/Toast";
import "./globals.css";

export const metadata: Metadata = {
  title: "科技情报采集器",
  description: "Node.js 科技情报采集 + AI 审核沙盒",
};

export const dynamic = "force-dynamic";

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const currentUser = await getCurrentUser();

  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        {/* 防止暗色模式 FOUC — 在 HTML 解析前同步执行 */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem("theme");if(t==="dark"||(!t&&matchMedia("(prefers-color-scheme:dark)").matches))document.documentElement.classList.add("dark")}catch(e){}`,
          }}
        />
      </head>
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased dark:bg-slate-950 dark:text-slate-100">
        <ThemeProvider>
          <nav className="sticky top-0 z-10 border-b border-slate-200 bg-white/80 backdrop-blur dark:border-slate-800 dark:bg-slate-950/80">
            <div className="relative mx-auto flex max-w-5xl items-center justify-between px-4 sm:px-6 py-3">
              <Link
                href="/"
                className="text-lg font-bold tracking-tight text-slate-900 shrink-0 dark:text-slate-100"
              >
                科技情报
              </Link>
              <div className="flex items-center gap-3">
                <NavLinks role={currentUser?.role} />
                <ThemeToggle />
                {currentUser && <UserMenu username={currentUser.username} />}
              </div>
            </div>
          </nav>
          <ToastProvider>{children}</ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
