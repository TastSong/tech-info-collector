"use client";

import { useState, useEffect, useRef } from "react";

/**
 * 数字滚动动画组件：页面首次加载时从 0 递增到目标值。
 */
export function AnimatedNumber({
  value,
  duration = 800,
}: {
  value: number;
  duration?: number;
}) {
  const [display, setDisplay] = useState(0);
  const prevValue = useRef(0);

  useEffect(() => {
    // 如果值改变了，重新播放动画
    if (value === prevValue.current) return;
    prevValue.current = value;

    const startValue = 0;
    const startTime = performance.now();

    function step(now: number) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // ease-out quad
      const eased = 1 - (1 - progress) * (1 - progress);
      setDisplay(Math.round(startValue + (value - startValue) * eased));
      if (progress < 1) requestAnimationFrame(step);
    }

    requestAnimationFrame(step);
  }, [value, duration]);

  return <>{display.toLocaleString("zh-CN")}</>;
}
