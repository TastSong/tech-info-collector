/**
 * 按域名隔离的限流队列：每个 host 一个 p-queue，并发 1、每 2s 最多 1 个请求。
 * 避免把目标站点打挂，也避免撞自己清单里的重复域名。
 */
import PQueue from "p-queue";

const INTERVAL_MS = 2000;

const queues = new Map<string, PQueue>();

export function queueFor(url: string): PQueue {
  const host = (() => {
    try {
      return new URL(url).host;
    } catch {
      return url;
    }
  })();

  let q = queues.get(host);
  if (!q) {
    q = new PQueue({ concurrency: 1, interval: INTERVAL_MS, intervalCap: 1 });
    queues.set(host, q);
  }
  return q;
}
