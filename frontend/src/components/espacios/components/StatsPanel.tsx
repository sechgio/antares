import { AlertCircle, CalendarOff, CheckCircle2, Circle, ListTodo } from 'lucide-react';
import type { TaskStats } from '../utils/filters';

interface StatsPanelProps {
  stats: TaskStats;
  filteredCount: number;
  totalCount: number;
}

function StatItem({
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
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-[var(--text-muted)]">
      <Icon className="h-3.5 w-3.5 shrink-0 opacity-80" strokeWidth={1.75} aria-hidden />
      <span>{label}</span>
      <span className={`tabular-nums font-medium ${toneClass}`}>{value}</span>
    </span>
  );
}

function Divider() {
  return <span className="h-3 w-px shrink-0 bg-[var(--border-subtle)]" aria-hidden />;
}

export default function StatsPanel({ stats, filteredCount, totalCount }: StatsPanelProps) {
  return (
    <div
      className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5"
      role="group"
      aria-label="Resumen del proyecto"
    >
      <span className="inline-flex items-center gap-2 whitespace-nowrap text-xs text-[var(--text-muted)]">
        <span>Progreso</span>
        <span className="tabular-nums font-medium text-[var(--text-primary)]">{stats.progress}%</span>
        <span className="h-1.5 w-16 overflow-hidden rounded-full bg-[var(--bg-input)] sm:w-20">
          <span
            className="block h-full rounded-full bg-[var(--accent-primary)] transition-all duration-300"
            style={{ width: `${stats.progress}%` }}
          />
        </span>
      </span>

      <Divider />

      <StatItem icon={ListTodo} label="Total" value={stats.total} />
      <Divider />
      <StatItem icon={Circle} label="Abiertas" value={stats.open} />
      <Divider />
      <StatItem icon={CheckCircle2} label="Completadas" value={stats.completed} tone="success" />
      <Divider />
      <StatItem icon={AlertCircle} label="Atrasadas" value={stats.overdue} tone="warning" />
      <Divider />
      <StatItem icon={CalendarOff} label="Sin fecha" value={stats.unscheduled} />

      {filteredCount !== totalCount && (
        <>
          <Divider />
          <span className="whitespace-nowrap text-[11px] text-[var(--text-muted)]">
            Mostrando {filteredCount} de {totalCount}
          </span>
        </>
      )}
    </div>
  );
}
