/**
 * Next.js Instrumentation Hook — 服务启动时自动启动调度器。
 * 无需单独的 pnpm scheduler 进程。
 */

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startScheduler } = await import("./src/scheduler/cron");
    startScheduler();
  }
}
