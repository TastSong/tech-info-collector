"use client";

import { useRouter } from "next/navigation";

export function UserMenu({ username }: { username: string }) {
  const router = useRouter();

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  };

  return (
    <div className="flex items-center gap-2">
      <span className="hidden sm:inline text-sm text-slate-500">
        {username}
      </span>
      <button
        onClick={handleLogout}
        className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition-colors"
      >
        退出
      </button>
    </div>
  );
}
