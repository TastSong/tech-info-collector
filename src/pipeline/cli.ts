/**
 * 采集 CLI：pnpm crawl [siteId]
 *   - 带站点 id：只跑该站点
 *   - 不带：跑所有 enabled 站点（按域名分组并行，环境变量 CRAWL_CONCURRENCY 控制并发数，默认 10）
 *
 * 核心编排逻辑已提取到 service.ts，CLI 只负责入口参数解析和退出码。
 */
import { runCrawl } from "./service";

const CONCURRENCY = Number(process.env.CRAWL_CONCURRENCY ?? 10);

async function main() {
  const idArg = process.argv[2];
  const id = idArg ? Number(idArg) : null;

  try {
    const { summary } = await runCrawl({
      siteId: id ?? undefined,
      concurrency: CONCURRENCY,
    });
    process.exit(summary.status === "error" ? 1 : 0);
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
}

main();
