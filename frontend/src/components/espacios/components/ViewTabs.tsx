import { Calendar, ChartGantt, LayoutGrid, List } from 'lucide-react';
import type { VistaType } from '../types';

const VIEWS: { id: VistaType; label: string; icon: typeof List }[] = [
  { id: 'list', label: 'Lista', icon: List },
  { id: 'board', label: 'Tablero', icon: LayoutGrid },
  { id: 'calendar', label: 'Calendario', icon: Calendar },
  { id: 'gantt', label: 'Gantt', icon: ChartGantt },
];

interface ViewTabsProps {
  active: VistaType;
  onChange: (view: VistaType) => void;
}

export default function ViewTabs({ active, onChange }: ViewTabsProps) {
  return (
    <div className="flex gap-1 border-b border-[var(--border-subtle)] px-6">
      {VIEWS.map((view) => {
        const Icon = view.icon;
        const isActive = active === view.id;
        return (
          <button
            key={view.id}
            type="button"
            onClick={() => onChange(view.id)}
            className={`relative flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors ${
              isActive
                ? 'text-[var(--text-primary)]'
                : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
            }`}
          >
            <Icon className="h-4 w-4 shrink-0" strokeWidth={1.75} />
            {view.label}
            {isActive && (
              <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-[var(--accent-primary)]" />
            )}
          </button>
        );
      })}
    </div>
  );
}