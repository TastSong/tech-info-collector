export default function HomeLoading() {
  return (
    <main className="mx-auto max-w-5xl px-6 py-10 animate-pulse">
      {/* stats row */}
      <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="mb-2 h-3 w-16 rounded bg-slate-200" />
            <div className="h-7 w-10 rounded bg-slate-300" />
          </div>
        ))}
      </div>

      {/* section heading */}
      <div className="mb-3 h-5 w-24 rounded bg-slate-300" />

      {/* table skeleton */}
      <div className="rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-4 py-3">
          <div className="grid grid-cols-7 gap-4">
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="h-3 rounded bg-slate-200" />
            ))}
          </div>
        </div>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="border-b border-slate-50 px-4 py-3">
            <div className="grid grid-cols-7 gap-4">
              {Array.from({ length: 7 }).map((_, j) => (
                <div key={j} className="h-4 rounded bg-slate-100" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
