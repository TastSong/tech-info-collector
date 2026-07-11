"use client";

import { Sun, Moon } from "lucide-react";
import { useTheme } from "./ThemeProvider";

/**
 * 主题切换按钮：亮色 ☀ / 暗色 🌙。
 * 挂载在导航栏或 UserMenu 旁。
 */
export function ThemeToggle() {
  const { theme, toggle } = useTheme();

  return (
    <button
      onClick={toggle}
      className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800 transition-colors cursor-pointer"
      title={theme === "dark" ? "切换亮色模式" : "切换暗色模式"}
    >
      {theme === "dark" ? (
        <Sun className="h-4 w-4" />
      ) : (
        <Moon className="h-4 w-4" />
      )}
    </button>
  );
}
