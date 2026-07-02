"use client";

import { useEffect, useRef } from "react";

/**
 * 从 feed 页进入文章详情时，自动标记已读。
 * 通过 URL 参数 from=feed 判断；仅在首次挂载时触发一次。
 */
export function MarkViewed({ articleId }: { articleId: number }) {
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    if (typeof window === "undefined") return;

    const params = new URLSearchParams(window.location.search);
    if (params.get("from") !== "feed") return;

    fired.current = true;
    fetch(`/api/articles/${articleId}/view`, { method: "POST" }).catch(() => {});
  }, [articleId]);

  return null;
}
