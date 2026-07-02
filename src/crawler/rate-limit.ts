/**
 * 按域名隔离的限流队列。
 * 每个 host 独立 PQueue：concurrency=CRAWL_PER_DOMAIN（默认 3），每 2s 最多 1 次（打散请求）。
 * 同域名内有并行能力（受 concurrency 上限），但 interval 保证不会瞬间打穿目标站点。
 */
import PQueue from "p-queue";

const INTERVAL_MS = 2000;
const PER_DOMAIN_CONCURRENCY = Number(process.env.CRAWL_PER_DOMAIN ?? 3);

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
    q = new PQueue({
      concurrency: PER_DOMAIN_CONCURRENCY,
      interval: INTERVAL_MS,
      intervalCap: PER_DOMAIN_CONCURRENCY,
    });
    queues.set(host, q);
  }
  return q;
}
