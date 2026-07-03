"use client";

import { useEffect, useState } from "react";

export default function LoginPage() {
  const [checking, setChecking] = useState(true);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

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
        setSubmitting(false);
        return;
      }
      // 硬导航绕过 RSC 缓存，确保跳转到已认证页面
      window.location.href = "/";
    } catch {
      setError("网络错误，请重试");
      setSubmitting(false);
    }
  };

  if (checking) {
    return (
      <main className="mx-auto flex min-h-[60vh] max-w-md items-center justify-center px-6">
        <p className="text-slate-400">加载中…</p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-[60vh] max-w-md items-center justify-center px-6">
      <div className="w-full rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="mb-2 text-2xl font-bold tracking-tight text-slate-900">
          登录
        </h1>
        <p className="mb-6 text-sm text-slate-500">
          请输入管理员用户名和密码。
        </p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="username">
              用户名
            </label>
            <input
              id="username"
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
              placeholder="输入用户名"
              disabled={submitting}
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="password">
              密码
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
              placeholder="输入密码"
              disabled={submitting}
            />
          </div>

          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="mt-2 w-full rounded-lg bg-indigo-600 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
          >
            {submitting ? "登录中…" : "登录"}
          </button>
        </form>
      </div>
    </main>
  );
}
