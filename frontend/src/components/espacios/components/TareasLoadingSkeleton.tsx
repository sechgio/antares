import type { VistaType } from '../types';

function Pulse({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-[var(--bg-elevated)] ${className ?? ''}`} />;
}

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-2 px-2 py-1" aria-busy="true" aria-label="Cargando tareas">
      {Array.from({ length: 6 }, (_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 rounded-lg border border-[var(--border-subtle)] px-3 py-2.5"
        >
          <Pulse className="h-4 w-4 shrink-0 rounded" />
          <Pulse className="h-3.5 flex-1" />
          <Pulse className="h-5 w-16 shrink-0 rounded-full" />
          <Pulse className="h-3.5 w-20 shrink-0" />
        </div>
      ))}
    </div>
  );
}

function BoardSkeleton() {
  return (
    <div className="flex h-full min-h-0 gap-3 overflow-hidden px-4 pb-4 pt-2" aria-busy="true" aria-label="Cargando tareas">
      {Array.from({ length: 3 }, (_, i) => (
        <div
          key={i}
          className="flex w-64 shrink-0 flex-col gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3"
        >
          <Pulse className="mb-1 h-3.5 w-24" />
          {Array.from({ length: 3 }, (_, j) => (
            <Pulse key={j} className="h-16 w-full rounded-lg" />
          ))}
        </div>
      ))}
    </div>
  );
}

function TableSkeleton() {
  return (
    <div className="px-2" aria-busy="true" aria-label="Cargando tareas">
      <div className="overflow-hidden rounded-lg border border-[var(--border-subtle)]">
        <div className="border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2.5">
          <Pulse className="h-3 w-full max-w-md" />
        </div>
        {Array.from({ length: 7 }, (_, i) => (
          <div
            key={i}
            className="flex items-center gap-4 border-b border-[var(--border-subtle)] px-3 py-3 last:border-b-0"
          >
            <Pulse className="h-3.5 flex-1" />
            <Pulse className="h-3.5 w-20 shrink-0" />
            <Pulse className="h-3.5 w-24 shrink-0" />
            <Pulse className="h-3.5 w-16 shrink-0" />
          </div>
        ))}
      </div>
    </div>
  );
}

function TimelineSkeleton() {
  return (
    <div
      className="flex h-full min-h-0 flex-1 flex-col gap-3 bg-[var(--bg-elevated)] p-4"
      aria-busy="true"
      aria-label="Cargando tareas"
    >
      <Pulse className="h-8 w-full max-w-sm" />
      <div className="grid min-h-0 flex-1 grid-cols-7 gap-2">
        {Array.from({ length: 14 }, (_, i) => (
          <Pulse key={i} className="min-h-[4rem] rounded-lg" />
        ))}
      </div>
    </div>
  );
}

export default function TareasLoadingSkeleton({ view }: { view: VistaType }) {
  if (view === 'board') return <BoardSkeleton />;
  if (view === 'table') return <TableSkeleton />;
  if (view === 'calendar' || view === 'gantt') return <TimelineSkeleton />;
  return <ListSkeleton />;
}
