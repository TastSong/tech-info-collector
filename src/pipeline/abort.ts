/**
 * 采集中止信号（模块级单例）。
 * crawl route 启动时创建新的 AbortController，stop route 调用 abort()。
 * runSite / fetcher 各层透传 signal，在关键点检查 aborted 状态。
 * PQueue 引用也挂在这里，确保 stop 能 clear 掉所有排队任务。
 */
import type PQueue from "p-queue";

let controller: AbortController | null = null;
let currentQueue: PQueue | null = null;

/** 开始新一轮采集前调用，丢弃旧 controller（如有）。 */
export function createAbortController(pq: PQueue): AbortController {
  // 如果旧 controller 还在（上一轮未正常结束），先 abort 掉
  if (controller) {
    controller.abort();
  }
  controller = new AbortController();
  currentQueue = pq;
  return controller;
}

/** 获取当前采集的 AbortSignal（无采集时返回 undefined）。 */
export function getAbortSignal(): AbortSignal | undefined {
  return controller?.signal;
}

/** 停止当前采集。总是返回 true（即使没有内存中的 controller，DB 中有 running 日志也要清理）。 */
export function abortCrawl(): boolean {
  if (controller) {
    controller.abort();
    controller = null;
  }
  // 清空排队任务
  if (currentQueue) {
    currentQueue.clear();
    currentQueue = null;
  }
  // 总是返回 true，让 stop API 去清理 DB
  return true;
}
