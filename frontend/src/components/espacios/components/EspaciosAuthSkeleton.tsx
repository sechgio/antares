export default function EspaciosAuthSkeleton() {
  return (
    <div
      className="flex h-full min-h-0 overflow-hidden"
      aria-busy="true"
      aria-label="Cargando sesión"
    >
      <aside className="flex w-56 shrink-0 flex-col gap-3 border-r border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
        <div className="h-4 w-24 animate-pulse rounded bg-[var(--bg-elevated)]" />
        <div className="h-8 w-full animate-pulse rounded-lg bg-[var(--bg-elevated)]" />
        <div className="mt-2 flex flex-col gap-2">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="h-7 w-full animate-pulse rounded-md bg-[var(--bg-elevated)]" />
          ))}
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col gap-3 p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="h-5 w-40 animate-pulse rounded bg-[var(--bg-elevated)]" />
          <div className="h-8 w-28 animate-pulse rounded-lg bg-[var(--bg-elevated)]" />
        </div>
        <div className="flex gap-2">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="h-8 w-20 animate-pulse rounded-md bg-[var(--bg-elevated)]" />
          ))}
        </div>
        <div className="mt-2 flex flex-col gap-2">
          {Array.from({ length: 6 }, (_, i) => (
            <div
              key={i}
              className="h-11 w-full animate-pulse rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)]"
            />
          ))}
        </div>
      </div>
    </div>
  );
}
