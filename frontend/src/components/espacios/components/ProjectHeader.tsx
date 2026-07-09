import { Star } from 'lucide-react';
import type { RealtimeStatus } from '../api/realtime';
import type { Proyecto } from '../types';
import type { TaskStats } from '../utils/filters';
import StatsPanel from './StatsPanel';

interface ProjectHeaderProps {
  proyecto: Proyecto | null;
  stats: TaskStats | null;
  filteredCount?: number;
  totalCount?: number;
  realtimeStatus?: RealtimeStatus;
  onToggleFavorite: () => void;
}

function RealtimeBadge({ status }: { status: RealtimeStatus }) {
  if (status === 'idle' || status === 'offline') return null;

  const config =
    status === 'live'
      ? { label: 'En vivo', dot: 'bg-emerald-500', title: 'Sincronización en tiempo real activa' }
      : status === 'connecting'
        ? { label: 'Conectando…', dot: 'bg-amber-400 animate-pulse', title: 'Conectando a sincronización en vivo' }
        : { label: 'Sin sync', dot: 'bg-[var(--accent-red)]', title: 'No se pudo conectar al tiempo real' };

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 py-0.5 text-[10px] font-medium text-[var(--text-muted)]"
      title={config.title}
      aria-label={config.title}
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${config.dot}`} aria-hidden />
      {config.label}
    </span>
  );
}

export default function ProjectHeader({
  proyecto,
  stats,
  filteredCount,
  totalCount,
  realtimeStatus = 'idle',
  onToggleFavorite,
}: ProjectHeaderProps) {
  if (!proyecto) {
    return null;
  }

  return (
    <div className="border-b border-[var(--border-subtle)] px-6 py-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="truncate text-xl font-semibold text-[var(--text-primary)]">{proyecto.name}</h1>
          <button
            type="button"
            onClick={onToggleFavorite}
            className="shrink-0 rounded-md p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-amber-400"
            aria-label={proyecto.is_favorite ? 'Quitar favorito' : 'Marcar favorito'}
          >
            <Star className={`h-4 w-4 ${proyecto.is_favorite ? 'fill-amber-400 text-amber-400' : ''}`} />
          </button>
          <RealtimeBadge status={realtimeStatus} />
        </div>

        {stats && (
          <StatsPanel
            stats={stats}
            filteredCount={filteredCount ?? stats.total}
            totalCount={totalCount ?? stats.total}
          />
        )}
      </div>
    </div>
  );
}
