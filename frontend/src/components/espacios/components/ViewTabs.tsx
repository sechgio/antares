import { Calendar, ChartGantt, LayoutGrid, List, Table2 } from 'lucide-react';
import type { VistaType } from '../types';

const VIEWS: { id: VistaType; label: string; icon: typeof List; color: string }[] = [
  { id: 'list', label: 'Lista', icon: List, color: '#87909E' },
  { id: 'board', label: 'Tablero', icon: LayoutGrid, color: '#5F55EE' },
  { id: 'table', label: 'Tabla', icon: Table2, color: '#0F9D58' },
  { id: 'calendar', label: 'Calendario', icon: Calendar, color: '#F59E0B' },
  { id: 'gantt', label: 'Gantt', icon: ChartGantt, color: '#22C7A9' },
];

interface ViewTabsProps {
  active: VistaType;
  onChange: (view: VistaType) => void;
}

export default function ViewTabs({ active, onChange }: ViewTabsProps) {
  return (
    <div className="flex items-center gap-0.5 border-b border-[var(--border-subtle)] px-4">
      {VIEWS.map((view) => {
        const Icon = view.icon;
        const isActive = active === view.id;
        return (
          <button
            key={view.id}
            type="button"
            onClick={() => onChange(view.id)}
            className={`relative flex items-center gap-1.5 px-3 py-2.5 text-[13px] font-medium transition-colors ${
              isActive
                ? 'text-[var(--text-primary)]'
                : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
            }`}
          >
            <Icon
              className="h-3.5 w-3.5 shrink-0"
              strokeWidth={isActive ? 2.25 : 1.75}
              style={{ color: isActive ? view.color : undefined }}
            />
            {view.label}
            {isActive && (
              <span
                className="absolute inset-x-2 bottom-0 h-[2px] rounded-full"
                style={{ background: view.color }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}