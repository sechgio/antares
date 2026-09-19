import { AnimatePresence, motion } from 'framer-motion';
import {
  Calendar,
  Columns3,
  FolderKanban,
  GanttChart,
  LayoutList,
  Table2,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import Button from '../../ui/Button';

export type PreviewView = 'list' | 'board' | 'table' | 'calendar' | 'gantt';

export const MOTION_EASE = [0.16, 1, 0.3, 1] as const;

export const VIEWS: { id: PreviewView; icon: LucideIcon; label: string; description: string; color: string }[] = [
  { id: 'list', icon: LayoutList, label: 'Lista', description: 'Vista simple', color: 'var(--accent-primary)' },
  { id: 'board', icon: Columns3, label: 'Tablero', description: 'Kanban visual', color: 'var(--accent-secondary)' },
  { id: 'table', icon: Table2, label: 'Tabla', description: 'Filas y columnas', color: 'var(--accent-green)' },
  { id: 'calendar', icon: Calendar, label: 'Calendario', description: 'Por fechas', color: 'var(--accent-blue)' },
  { id: 'gantt', icon: GanttChart, label: 'Gantt', description: 'Línea de tiempo', color: 'var(--accent-yellow)' },
];

function SidebarMock() {
  return (
    <div className="w-[88px] shrink-0 border-r border-[var(--border-subtle)] bg-[var(--bg-base)] p-2.5">
      <p className="mb-2 text-[8px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Espacios</p>
      {['#5E6AD2', '#22C7A9', '#F59E0B'].map((color, i) => (
        <div
          key={color}
          className={`mb-1.5 flex items-center gap-1.5 rounded-md px-1.5 py-1 ${i === 0 ? 'bg-[color:color-mix(in_srgb,var(--accent-primary)_12%,transparent)]' : ''}`}
        >
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
          <span className="h-1.5 flex-1 rounded-full bg-[var(--border-medium)]" />
        </div>
      ))}
      <div className="mt-3 border-t border-[var(--border-subtle)] pt-2">
        <p className="mb-1.5 text-[8px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Proyectos</p>
        {[0, 1].map((i) => (
          <div key={i} className="mb-1 flex items-center gap-1 rounded-md px-1 py-0.5">
            <FolderKanban className="h-2.5 w-2.5 text-[var(--text-muted)]" />
            <span className="h-1.5 flex-1 rounded-full bg-[var(--border-medium)]" />
          </div>
        ))}
      </div>
    </div>
  );
}

function ListPreview() {
  const rows = [
    { status: 'En curso', color: '#5F55EE', width: '72%' },
    { status: 'Pendiente', color: '#87909E', width: '58%' },
    { status: 'Completados', color: '#0F9D58', width: '84%' },
    { status: 'En curso', color: '#5F55EE', width: '65%' },
  ];
  return (
    <div className="flex flex-1 flex-col gap-1 p-1">
      <div className="mb-1 flex gap-2 border-b border-[var(--border-subtle)] px-1 pb-1.5">
        {['Tarea', 'Estado', 'Fecha'].map((col) => (
          <span key={col} className="flex-1 text-[7px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
            {col}
          </span>
        ))}
      </div>
      {rows.map((row, i) => (
        <div key={i} className="flex items-center gap-2 rounded-md bg-[var(--bg-base)] px-1.5 py-1.5">
          <span className="h-1.5 flex-[2] rounded-full bg-[var(--border-medium)]" style={{ maxWidth: row.width }} />
          <span
            className="flex-1 rounded px-1 py-0.5 text-center text-[7px] font-medium"
            style={{ background: `color-mix(in srgb, ${row.color} 15%, transparent)`, color: row.color }}
          >
            {row.status}
          </span>
          <span className="h-1.5 w-8 rounded-full bg-[var(--border-subtle)]" />
        </div>
      ))}
    </div>
  );
}

function BoardPreview() {
  return (
    <div className="flex flex-1 gap-1.5 p-1">
      {[
        { label: 'Pendiente', color: '#87909E', count: 3, filled: false },
        { label: 'En curso', color: '#5F55EE', count: 2, filled: true },
        { label: 'Completados', color: '#0F9D58', count: 1, filled: true },
        { label: 'Urgente', color: '#EF4444', count: 1, filled: false },
      ].map((col) => (
        <div
          key={col.label}
          className="flex min-w-0 flex-1 flex-col rounded-lg p-1.5"
          style={{ background: `color-mix(in srgb, ${col.color} 12%, var(--bg-base))` }}
        >
          <div className="mb-1.5 flex items-center">
            <span
              className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-[7px] font-bold uppercase"
              style={
                col.filled
                  ? { background: col.color, color: '#fff' }
                  : { color: col.color, background: `color-mix(in srgb, ${col.color} 16%, transparent)` }
              }
            >
              {col.label} {col.count}
            </span>
          </div>
          {Array.from({ length: Math.min(col.count, 2) }).map((_, i) => (
            <div
              key={i}
              className="mb-1 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-1.5 shadow-sm"
            >
              <div className="mb-1 h-1 w-3/4 rounded-full bg-[var(--border-medium)]" />
              <div className="h-1 w-1/2 rounded-full bg-[var(--border-subtle)]" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function TablePreview() {
  const rows = [
    { status: 'En curso', color: '#5F55EE', flag: '#F59E0B' },
    { status: 'Pendiente', color: '#87909E', flag: '#87909E' },
    { status: 'Urgente', color: '#EF4444', flag: '#EF4444' },
    { status: 'Completados', color: '#0F9D58', flag: '#87909E' },
  ];
  return (
    <div className="flex flex-1 flex-col gap-1 p-1.5">
      <div className="mb-0.5 flex gap-1 border-b border-[var(--border-subtle)] px-1 pb-1">
        {['#', 'Name', 'Estado', 'Fecha', 'Prior.'].map((col) => (
          <span key={col} className="flex-1 text-[6px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
            {col}
          </span>
        ))}
      </div>
      {rows.map((row, i) => (
        <div key={i} className="flex items-center gap-1 rounded bg-[var(--bg-base)] px-1 py-1">
          <span className="w-2 text-[6px] text-[var(--text-muted)]">{i + 1}</span>
          <span className="h-1 flex-[2] rounded-full bg-[var(--border-medium)]" />
          <span
            className="flex-1 rounded px-0.5 py-0.5 text-center text-[6px] font-bold uppercase"
            style={{ color: row.color, background: `color-mix(in srgb, ${row.color} 16%, transparent)` }}
          >
            {row.status.slice(0, 4)}
          </span>
          <span className="h-1 flex-1 rounded-full bg-[var(--border-subtle)]" />
          <span className="h-1.5 w-1.5 rounded-sm" style={{ background: row.flag }} />
        </div>
      ))}
    </div>
  );
}

function CalendarPreview() {
  const days = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
  const events = [3, 0, 5, 0, 2, 0, 1, 4, 0, 0, 6, 0, 0, 3, 0, 2, 0, 0, 1, 0, 0, 4, 0, 0, 0, 2, 0, 0];
  return (
    <div className="flex flex-1 flex-col p-2">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[9px] font-medium text-[var(--text-secondary)]">Marzo 2026</span>
        <span className="text-[7px] text-[var(--text-muted)]">12 tareas</span>
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {days.map((d) => (
          <span key={d} className="text-center text-[7px] font-medium text-[var(--text-muted)]">
            {d}
          </span>
        ))}
        {events.map((count, i) => (
          <div
            key={i}
            className={`flex h-5 items-center justify-center rounded text-[7px] ${
              count > 0 ? 'bg-[color:color-mix(in_srgb,var(--accent-primary)_15%,transparent)] font-medium text-[var(--accent-primary-hover)]' : 'text-[var(--text-muted)]'
            }`}
          >
            {count > 0 ? count : i + 1}
          </div>
        ))}
      </div>
    </div>
  );
}

function GanttPreview() {
  const bars = [
    { label: 'Diseño', start: 8, width: 28, color: 'var(--accent-primary)' },
    { label: 'Desarrollo', start: 22, width: 42, color: 'var(--accent-blue)' },
    { label: 'QA', start: 55, width: 20, color: 'var(--accent-secondary)' },
    { label: 'Deploy', start: 72, width: 18, color: 'var(--accent-green)' },
  ];
  return (
    <div className="flex flex-1 flex-col justify-center gap-2.5 p-3">
      {bars.map((bar) => (
        <div key={bar.label} className="flex items-center gap-2">
          <span className="w-14 shrink-0 truncate text-[7px] text-[var(--text-muted)]">{bar.label}</span>
          <div className="relative h-3 flex-1 rounded-full bg-[var(--bg-base)]">
            <div
              className="absolute top-0 h-full rounded-full"
              style={{
                left: `${bar.start}%`,
                width: `${bar.width}%`,
                background: `color-mix(in srgb, ${bar.color} 70%, transparent)`,
                boxShadow: `0 0 8px color-mix(in srgb, ${bar.color} 40%, transparent)`,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function PreviewContent({ view, reducedMotion }: { view: PreviewView; reducedMotion: boolean }) {
  const content = {
    list: <ListPreview />,
    board: <BoardPreview />,
    table: <TablePreview />,
    calendar: <CalendarPreview />,
    gantt: <GanttPreview />,
  }[view];

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={view}
        initial={reducedMotion ? false : { y: 6 }}
        animate={{ y: 0 }}
        exit={reducedMotion ? undefined : { y: -6 }}
        transition={{ duration: 0.25, ease: MOTION_EASE }}
        className="flex min-h-0 flex-1 flex-col"
      >
        {content}
      </motion.div>
    </AnimatePresence>
  );
}

interface PreviewMockupProps {
  activeView: PreviewView;
  onViewChange: (view: PreviewView) => void;
  reducedMotion: boolean;
}

export function PreviewMockup({ activeView, onViewChange, reducedMotion }: PreviewMockupProps) {
  return (
    <div className="relative mx-auto w-full max-w-lg select-none" aria-hidden>
      <div className="absolute -inset-6 rounded-[2rem] bg-[color:color-mix(in_srgb,var(--accent-primary)_10%,transparent)] blur-3xl" />
      <div className="absolute -right-4 -top-4 h-24 w-24 rounded-full bg-[color:color-mix(in_srgb,var(--accent-secondary)_8%,transparent)] blur-2xl" />

      <motion.div
        initial={reducedMotion ? false : { y: 16, scale: 0.98 }}
        animate={{ y: 0, scale: 1 }}
        transition={{ duration: 0.55, delay: 0.1, ease: MOTION_EASE }}
        className="relative overflow-hidden rounded-2xl border border-[var(--border-medium)] bg-[var(--bg-elevated)] shadow-[0_32px_64px_color-mix(in_srgb,var(--bg-base)_70%,transparent),0_0_0_1px_color-mix(in_srgb,var(--accent-primary)_12%,transparent)]"
      >
        <div className="flex items-center gap-1.5 border-b border-[var(--border-subtle)] px-4 py-2.5">
          <span className="h-2.5 w-2.5 rounded-full bg-[color:color-mix(in_srgb,var(--accent-red)_80%,transparent)]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[color:color-mix(in_srgb,var(--accent-yellow)_80%,transparent)]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[color:color-mix(in_srgb,var(--accent-green)_80%,transparent)]" />
          <span className="ml-2 text-[10px] text-[var(--text-muted)]">Espacios — Vista previa</span>
        </div>

        <div className="flex h-64">
          <SidebarMock />
          <div className="flex min-w-0 flex-1 flex-col p-2.5">
            <div className="mb-2 flex gap-1">
              {VIEWS.map((tab) => {
                const isActive = activeView === tab.id;
                return (
                  <Button variant="none" size="none"
                    key={tab.id}
                    onClick={() => onViewChange(tab.id)}
                    className={`rounded-md px-2 py-0.5 text-[8px] transition-colors ${
                      isActive
                        ? 'bg-[color:color-mix(in_srgb,var(--accent-primary)_20%,transparent)] font-semibold text-[var(--accent-primary-hover)]'
                        : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                    }`}
                  >
                    {tab.label}
                  </Button>
                );
              })}
            </div>
            <PreviewContent view={activeView} reducedMotion={reducedMotion} />
          </div>
        </div>
      </motion.div>
    </div>
  );
}
