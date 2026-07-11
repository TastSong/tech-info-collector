export default function HomeLoading() {
  return (
    <main className="mx-auto max-w-5xl px-6 py-10 animate-pulse">
      {/* stats row */}
      <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
            <div className="mb-2 h-3 w-16 rounded bg-slate-200 dark:bg-slate-700" />
            <div className="h-7 w-10 rounded bg-slate-300 dark:bg-slate-600" />
          </div>
        ))}
      </div>

      {/* section heading */}
      <div className="mb-3 h-5 w-24 rounded bg-slate-300 dark:bg-slate-700" />

      {/* table skeleton */}
      <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
        <div className="border-b border-slate-100 px-4 py-3 dark:border-slate-700">
          <div className="grid grid-cols-7 gap-4">
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="h-3 rounded bg-slate-200 dark:bg-slate-700" />
            ))}
          </div>
        </div>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="border-b border-slate-50 px-4 py-3 dark:border-slate-700">
            <div className="grid grid-cols-7 gap-4">
              {Array.from({ length: 7 }).map((_, j) => (
                <div key={j} className="h-4 rounded bg-slate-100 dark:bg-slate-800" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
