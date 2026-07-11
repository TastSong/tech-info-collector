"use client";

import { useEffect, useState } from "react";
import { Bot, User, Lock, Loader2, LogIn } from "lucide-react";

export default function LoginPage() {
  const [checking, setChecking] = useState(true);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [shaking, setShaking] = useState(false);

  useEffect(() => {
    // 检查是否已登录
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((data) => {
        if (data.user) window.location.href = "/";
      })
      .catch(() => {})
      .finally(() => setChecking(false));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!username.trim() || !password) {
      setError("请填写用户名和密码");
      setShaking(true);
      setTimeout(() => setShaking(false), 400);
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "登录失败");
        setShaking(true);
        setTimeout(() => setShaking(false), 400);
        setSubmitting(false);
        return;
      }
      // 硬导航绕过 RSC 缓存，确保跳转到已认证页面
      window.location.href = "/";
    } catch {
      setError("网络错误，请重试");
      setShaking(true);
      setTimeout(() => setShaking(false), 400);
      setSubmitting(false);
    }
  };

  if (checking) {
    return (
      <main className="mx-auto flex min-h-[60vh] max-w-md items-center justify-center px-6">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400 dark:text-slate-400" />
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-[70vh] max-w-md items-center justify-center px-6">
      <div className={`w-full rounded-2xl border border-slate-200 bg-white p-8 shadow-sm dark:bg-slate-900 dark:border-slate-800 ${shaking ? "animate-shake" : ""}`}>
        {/* Logo & heading */}
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-500 shadow-md">
            <Bot className="h-7 w-7 text-white" />
          </div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            科技情报采集器
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            请登录以继续
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300" htmlFor="username">
              用户名
            </label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 dark:text-slate-500" />
              <input
                id="username"
                type="text"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full rounded-lg border border-slate-300 pl-10 pr-3 py-2.5 text-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-indigo-500 dark:focus:ring-indigo-800"
                placeholder="输入用户名"
                disabled={submitting}
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300" htmlFor="password">
              密码
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 dark:text-slate-500" />
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-slate-300 pl-10 pr-3 py-2.5 text-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-indigo-500 dark:focus:ring-indigo-800"
                placeholder="输入密码"
                disabled={submitting}
              />
            </div>
          </div>

          {error && (
            <p className="rounded-lg bg-red-50 border border-red-100 px-3 py-2 text-sm text-red-600 animate-slide-down dark:bg-red-950/30 dark:border-red-800 dark:text-red-400">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 py-2.5 text-sm font-semibold text-white transition-all hover:bg-indigo-700 hover:shadow-md disabled:opacity-50"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                登录中…
              </>
            ) : (
              <>
                <LogIn className="h-4 w-4" />
                登录
              </>
            )}
          </button>
        </form>
      </div>
    </main>
  );
}
