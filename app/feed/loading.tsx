/**
 * Feed 页面加载骨架屏。
 *
 * 模拟最终页面的结构：搜索栏 → 统计行 → 日期分组 → 文章卡片，
 * 使用 animate-pulse 提供加载中视觉反馈，避免首屏空白。
 */

function FilterBarSkeleton() {
  return (
    <div className="mb-6 rounded-xl border border-slate-200 bg-white p-4 animate-pulse">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[200px]">
          <div className="mb-1 h-3 w-10 rounded bg-slate-200" />
          <div className="h-10 w-full rounded-lg bg-slate-100" />
        </div>
        <div className="min-w-[140px]">
          <div className="mb-1 h-3 w-8 rounded bg-slate-200" />
          <div className="h-10 w-full rounded-lg bg-slate-100" />
        </div>
        <div className="min-w-[160px]">
          <div className="mb-1 h-3 w-8 rounded bg-slate-200" />
          <div className="h-10 w-full rounded-lg bg-slate-100" />
        </div>
      </div>
    </div>
  );
}

function StatSkeleton() {
  return (
    <div className="mb-4 flex items-center justify-between animate-pulse">
      <div className="h-4 w-48 rounded bg-slate-200" />
      <div className="h-7 w-28 rounded-lg bg-slate-200" />
    </div>
  );
}

function CardSkeleton() {
  return (
    <div className="flex items-center rounded-xl border border-slate-200 bg-white p-4 animate-pulse">
      <div className="flex-1 min-w-0 space-y-2">
        <div className="h-5 w-3/4 rounded bg-slate-200" />
        <div className="h-4 w-full rounded bg-slate-100" />
        <div className="h-4 w-2/3 rounded bg-slate-100" />
        <div className="flex items-center gap-2">
          <div className="h-3 w-16 rounded bg-slate-100" />
          <div className="h-3 w-12 rounded bg-slate-100" />
        </div>
      </div>
      <div className="ml-3 h-8 w-16 rounded-lg bg-slate-100" />
    </div>
  );
}

function DayGroupSkeleton({ cardCount }: { cardCount: number }) {
  return (
    <section>
      <div className="mb-4 flex items-center gap-2 animate-pulse">
        <div className="h-5 w-24 rounded bg-slate-300" />
        <div className="h-3 w-16 rounded bg-slate-200" />
      </div>
      <div className="space-y-6">
        <div>
          <div className="mb-2 flex items-center gap-2 animate-pulse">
            <div className="h-1.5 w-1.5 rounded-full bg-slate-300" />
            <div className="h-4 w-32 rounded bg-slate-200" />
            <div className="h-3 w-8 rounded bg-slate-100" />
          </div>
          <div className="space-y-2">
            {Array.from({ length: cardCount }).map((_, i) => (
              <CardSkeleton key={i} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

export default function FeedLoading() {
  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">资讯流</h1>
      </div>

      <FilterBarSkeleton />
      <StatSkeleton />

      <div className="space-y-10">
        <DayGroupSkeleton cardCount={3} />
        <DayGroupSkeleton cardCount={4} />
        <DayGroupSkeleton cardCount={2} />
      </div>
    </main>
  );
}
