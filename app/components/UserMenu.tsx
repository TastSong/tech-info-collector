"use client";

import { useRouter } from "next/navigation";
import { User, LogOut } from "lucide-react";

export function UserMenu({ username }: { username: string }) {
  const router = useRouter();

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  };

  return (
    <div className="flex items-center gap-2">
      <span className="hidden sm:inline-flex items-center gap-1.5 text-sm text-slate-500">
        <User className="h-4 w-4" />
        {username}
      </span>
      <button
        onClick={handleLogout}
        className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition-colors"
      >
        <LogOut className="h-4 w-4" />
        退出
      </button>
    </div>
  );
}
