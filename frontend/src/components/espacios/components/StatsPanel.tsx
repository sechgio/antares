import { AlertCircle, CalendarOff, CheckCircle2, Circle, ListTodo } from 'lucide-react';
import type { TaskStats } from '../utils/filters';

interface StatsPanelProps {
  stats: TaskStats;
  filteredCount: number;
  totalCount: number;
}

function StatRow({
  icon: Icon,
  label,
  value,
  tone = 'default',
}: {
  icon: typeof ListTodo;
  label: string;
  value: number;
  tone?: 'default' | 'warning' | 'success';
}) {
  const toneClass =
    tone === 'warning'
      ? 'text-[var(--accent-red)]'
      : tone === 'success'
        ? 'text-[var(--accent-green,#22c55e)]'
        : 'text-[var(--text-primary)]';

  return (
    <div className="flex items-center justify-between gap-2 py-1.5">
      <span className="flex items-center gap-2 text-[var(--text-muted)]">
        <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
        {label}
      </span>
      <span className={`tabular-nums font-medium ${toneClass}`}>{value}</span>
    </div>
  );
}

export default function StatsPanel({ stats, filteredCount, totalCount }: StatsPanelProps) {
  return (
    <aside className="hidden w-52 shrink-0 border-l border-[var(--border-subtle)] bg-[var(--bg-elevated)]/30 px-4 py-4 lg:block">
      <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
        Resumen
      </h3>

      <div className="mb-4">
        <div className="mb-1.5 flex items-center justify-between text-xs">
          <span className="text-[var(--text-muted)]">Progreso</span>
          <span className="font-medium text-[var(--text-primary)]">{stats.progress}%</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-[var(--bg-input)]">
          <div
            className="h-full rounded-full bg-[var(--accent-primary)] transition-all duration-300"
            style={{ width: `${stats.progress}%` }}
          />
        </div>
      </div>

      <div className="space-y-0.5 text-xs">
        <StatRow icon={ListTodo} label="Total" value={stats.total} />
        <StatRow icon={Circle} label="Abiertas" value={stats.open} />
        <StatRow icon={CheckCircle2} label="Completadas" value={stats.completed} tone="success" />
        <StatRow icon={AlertCircle} label="Atrasadas" value={stats.overdue} tone="warning" />
        <StatRow icon={CalendarOff} label="Sin fecha" value={stats.unscheduled} />
      </div>

      {filteredCount !== totalCount && (
        <p className="mt-4 border-t border-[var(--border-subtle)] pt-3 text-[11px] text-[var(--text-muted)]">
          Mostrando {filteredCount} de {totalCount} tareas
        </p>
      )}
    </aside>
  );
}