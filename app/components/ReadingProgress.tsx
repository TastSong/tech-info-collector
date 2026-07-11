"use client";

import { useEffect, useState } from "react";

/**
 * 页面顶部阅读进度条，随滚动填充。
 * 在文章详情页使用，提供阅读位置感知。
 */
export function ReadingProgress() {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const onScroll = () => {
      const scrollTop = window.scrollY;
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      setProgress(docHeight > 0 ? Math.min(scrollTop / docHeight, 1) : 0);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div
      className="fixed top-0 left-0 z-50 h-1 bg-gradient-to-r from-indigo-400 to-purple-500 transition-[width] duration-150 ease-out"
      style={{ width: `${Math.round(progress * 100)}%` }}
    />
  );
}
