import { Star } from 'lucide-react';
import type { Proyecto } from '../types';
import type { TaskStats } from '../utils/filters';

interface ProjectHeaderProps {
  proyecto: Proyecto | null;
  stats: TaskStats | null;
  onToggleFavorite: () => void;
}

export default function ProjectHeader({ proyecto, stats, onToggleFavorite }: ProjectHeaderProps) {
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
        </div>

        {stats && stats.total > 0 && (
          <div className="flex items-center gap-3 text-xs text-[var(--text-muted)]">
            <span>
              <span className="font-medium text-[var(--text-primary)]">{stats.open}</span> abiertas
            </span>
            <span className="h-3 w-px bg-[var(--border-subtle)]" aria-hidden />
            <span>
              <span className="font-medium text-[var(--accent-green,#22c55e)]">{stats.completed}</span> completadas
            </span>
            {stats.overdue > 0 && (
              <>
                <span className="h-3 w-px bg-[var(--border-subtle)]" aria-hidden />
                <span className="text-[var(--accent-red)]">
                  <span className="font-medium">{stats.overdue}</span> atrasadas
                </span>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}