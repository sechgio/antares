import { AlertCircle, CalendarClock, CalendarOff } from 'lucide-react';

interface ViewStatsBarProps {
  scheduled: number;
  unscheduled: number;
  overdue: number;
}

export default function ViewStatsBar({ scheduled, unscheduled, overdue }: ViewStatsBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-base)] px-2.5 py-1 text-[11px] text-[var(--text-secondary)]">
        <CalendarClock className="h-3 w-3 text-[var(--accent-primary)]" />
        <span className="font-medium text-[var(--text-primary)]">{scheduled}</span>
        programadas
      </span>
      {unscheduled > 0 && (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-base)] px-2.5 py-1 text-[11px] text-[var(--text-muted)]">
          <CalendarOff className="h-3 w-3" />
          <span className="font-medium text-[var(--text-secondary)]">{unscheduled}</span>
          sin fecha
        </span>
      )}
      {overdue > 0 && (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--accent-red)]/25 bg-[var(--accent-red)]/8 px-2.5 py-1 text-[11px] text-[var(--accent-red)]">
          <AlertCircle className="h-3 w-3" />
          <span className="font-medium">{overdue}</span>
          atrasadas
        </span>
      )}
    </div>
  );
}