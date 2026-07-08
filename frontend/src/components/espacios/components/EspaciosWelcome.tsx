import { AnimatePresence, motion } from 'framer-motion';
import {
  Calendar,
  Columns3,
  FolderKanban,
  GanttChart,
  LayoutList,
  Plus,
  Sparkles,
  Zap,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import Button from '../../ui/Button';

interface EspaciosWelcomeProps {
  onCreateEspacio: () => void;
}

type PreviewView = 'list' | 'board' | 'calendar' | 'gantt';

const MOTION_EASE = [0.16, 1, 0.3, 1] as const;

const STEPS = [
  {
    step: '01',
    title: 'Crea un espacio',
    description: 'Agrupa el trabajo de tu equipo por área, cliente o departamento.',
    color: 'var(--accent-primary)',
  },
  {
    step: '02',
    title: 'Añade proyectos',
    description: 'Dentro de cada espacio organiza iniciativas con objetivos claros.',
    color: 'var(--accent-secondary)',
  },
  {
    step: '03',
    title: 'Gestiona tareas',
    description: 'Asigna responsables, fechas y estados en la vista que prefieras.',
    color: 'var(--accent-blue)',
  },
] as const;

const VIEWS: { id: PreviewView; icon: LucideIcon; label: string; description: string; color: string }[] = [
  { id: 'list', icon: LayoutList, label: 'Lista', description: 'Tabla ordenable', color: 'var(--accent-primary)' },
  { id: 'board', icon: Columns3, label: 'Tablero', description: 'Kanban visual', color: 'var(--accent-secondary)' },
  { id: 'calendar', icon: Calendar, label: 'Calendario', description: 'Por fechas', color: 'var(--accent-blue)' },
  { id: 'gantt', icon: GanttChart, label: 'Gantt', description: 'Línea de tiempo', color: 'var(--accent-yellow)' },
];

const PREVIEW_ROTATION: PreviewView[] = ['list', 'board', 'calendar', 'gantt'];

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = (event: MediaQueryList | MediaQueryListEvent) => setReduced(event.matches);
    update(query);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return reduced;
}

function fadeUp(delay: number) {
  return {
    initial: { opacity: 0, y: 16 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.55, delay, ease: MOTION_EASE },
  };
}

function SidebarMock() {
  return (
    <div className="w-[88px] shrink-0 border-r border-[var(--border-subtle)] bg-[var(--bg-base)] p-2.5">
      <p className="mb-2 text-[8px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Espacios</p>
      {['#5E6AD2', '#22C7A9', '#F59E0B'].map((color, i) => (
        <div
          key={color}
          className={`mb-1.5 flex items-center gap-1.5 rounded-md px-1.5 py-1 ${i === 0 ? 'bg-[var(--accent-primary)]/12' : ''}`}
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
    { status: 'En curso', color: 'var(--accent-blue)', width: '72%' },
    { status: 'Por hacer', color: 'var(--text-muted)', width: '58%' },
    { status: 'Hecho', color: 'var(--accent-green)', width: '84%' },
    { status: 'En curso', color: 'var(--accent-blue)', width: '65%' },
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
        { label: 'Por hacer', color: 'var(--text-muted)', count: 3 },
        { label: 'En curso', color: 'var(--accent-blue)', count: 2 },
        { label: 'Hecho', color: 'var(--accent-green)', count: 4 },
      ].map((col) => (
        <div key={col.label} className="flex min-w-0 flex-1 flex-col rounded-md bg-[var(--bg-base)] p-1.5">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[8px] font-medium" style={{ color: col.color }}>
              {col.label}
            </span>
            <span className="text-[7px] text-[var(--text-muted)]">{col.count}</span>
          </div>
          {Array.from({ length: Math.min(col.count, 2) }).map((_, i) => (
            <div
              key={i}
              className="mb-1 rounded border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-1.5"
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
              count > 0 ? 'bg-[var(--accent-primary)]/15 font-medium text-[var(--accent-primary-hover)]' : 'text-[var(--text-muted)]'
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

function PreviewContent({ view }: { view: PreviewView }) {
  const content = {
    list: <ListPreview />,
    board: <BoardPreview />,
    calendar: <CalendarPreview />,
    gantt: <GanttPreview />,
  }[view];

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={view}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -6 }}
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
}

function PreviewMockup({ activeView, onViewChange }: PreviewMockupProps) {
  return (
    <div className="relative mx-auto w-full max-w-lg select-none" aria-hidden>
      <div className="absolute -inset-6 rounded-[2rem] bg-[var(--accent-primary)]/10 blur-3xl" />
      <div className="absolute -right-4 -top-4 h-24 w-24 rounded-full bg-[var(--accent-secondary)]/8 blur-2xl" />

      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.7, delay: 0.15, ease: MOTION_EASE }}
        className="relative overflow-hidden rounded-2xl border border-[var(--border-medium)] bg-[var(--bg-elevated)] shadow-[0_32px_64px_color-mix(in_srgb,var(--bg-base)_70%,transparent),0_0_0_1px_color-mix(in_srgb,var(--accent-primary)_12%,transparent)]"
      >
        <div className="flex items-center gap-1.5 border-b border-[var(--border-subtle)] px-4 py-2.5">
          <span className="h-2.5 w-2.5 rounded-full bg-[var(--accent-red)]/80" />
          <span className="h-2.5 w-2.5 rounded-full bg-[var(--accent-yellow)]/80" />
          <span className="h-2.5 w-2.5 rounded-full bg-[var(--accent-green)]/80" />
          <span className="ml-2 text-[10px] text-[var(--text-muted)]">Espacios — Vista previa</span>
        </div>

        <div className="flex h-64">
          <SidebarMock />
          <div className="flex min-w-0 flex-1 flex-col p-2.5">
            <div className="mb-2 flex gap-1">
              {VIEWS.map((tab) => {
                const isActive = activeView === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => onViewChange(tab.id)}
                    className={`rounded-md px-2 py-0.5 text-[8px] transition-colors ${
                      isActive
                        ? 'bg-[var(--accent-primary)]/20 font-semibold text-[var(--accent-primary-hover)]'
                        : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                    }`}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>
            <PreviewContent view={activeView} />
          </div>
        </div>
      </motion.div>
    </div>
  );
}

export default function EspaciosWelcome({ onCreateEspacio }: EspaciosWelcomeProps) {
  const reducedMotion = useReducedMotion();
  const [activeView, setActiveView] = useState<PreviewView>('board');
  const [autoRotate, setAutoRotate] = useState(true);

  const handleViewChange = useCallback((view: PreviewView) => {
    setActiveView(view);
    setAutoRotate(false);
  }, []);

  useEffect(() => {
    if (reducedMotion || !autoRotate) return;
    const id = window.setInterval(() => {
      setActiveView((current) => {
        const idx = PREVIEW_ROTATION.indexOf(current);
        return PREVIEW_ROTATION[(idx + 1) % PREVIEW_ROTATION.length];
      });
    }, 4000);
    return () => window.clearInterval(id);
  }, [autoRotate, reducedMotion]);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="lg-aurora-blob lg-aurora-blob--indigo opacity-60" />
        <div className="lg-aurora-blob lg-aurora-blob--teal opacity-40" />
        <div
          className="absolute inset-0 opacity-[0.35]"
          style={{
            backgroundImage:
              'linear-gradient(color-mix(in srgb, var(--border-medium) 40%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in srgb, var(--border-medium) 40%, transparent) 1px, transparent 1px)',
            backgroundSize: '48px 48px',
            maskImage: 'radial-gradient(ellipse 80% 60% at 50% 30%, black, transparent)',
          }}
        />
      </div>

      <section className="relative border-b border-[var(--border-subtle)] px-6 py-10 lg:px-10 lg:py-16">
        <div className="relative mx-auto grid max-w-6xl items-center gap-10 lg:grid-cols-[1fr_1.15fr] lg:gap-16">
          <motion.div {...fadeUp(0)} className="space-y-7">
            <div className="inline-flex items-center gap-2 rounded-full border border-[var(--accent-primary)]/30 bg-[var(--accent-primary)]/10 px-3.5 py-1.5 text-xs font-medium text-[var(--accent-primary-hover)]">
              <Sparkles className="h-3.5 w-3.5" />
              Gestión de proyectos
            </div>

            <div className="space-y-4">
              <h1 className="text-3xl font-semibold leading-[1.15] tracking-tight text-[var(--text-primary)] lg:text-4xl">
                Organiza tu trabajo
                <br />
                <span className="lg-shimmer-text">en espacios</span>
              </h1>
              <p className="max-w-md text-sm leading-relaxed text-[var(--text-secondary)] lg:text-[15px]">
                Los espacios agrupan proyectos y tareas de tu equipo. Crea el primero para empezar
                a planificar con listas, tableros, calendario y Gantt.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-4">
              <Button
                type="button"
                size="lg"
                onClick={onCreateEspacio}
                className="gap-2 shadow-[0_8px_32px_color-mix(in_srgb,var(--accent-primary)_40%,transparent)]"
              >
                <Plus className="h-4 w-4" />
                Crear primer espacio
              </Button>
              <span className="inline-flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
                <Zap className="h-3.5 w-3.5 text-[var(--accent-yellow)]" />
                Toma menos de 1 minuto
              </span>
            </div>
          </motion.div>

          <PreviewMockup activeView={activeView} onViewChange={handleViewChange} />
        </div>
      </section>

      <section className="relative px-6 py-10 lg:px-10">
        <div className="mx-auto grid max-w-6xl gap-8 lg:grid-cols-[1.1fr_1fr]">
          <motion.div {...fadeUp(0.2)}>
            <h2 className="mb-6 text-sm font-semibold text-[var(--text-primary)]">Empieza en 3 pasos</h2>
            <div className="relative space-y-3">
              <div className="absolute bottom-4 left-[18px] top-4 hidden w-px bg-gradient-to-b from-[var(--accent-primary)]/40 via-[var(--accent-secondary)]/30 to-[var(--accent-blue)]/40 sm:block" />
              {STEPS.map((item, index) => (
                <motion.div
                  key={item.step}
                  {...fadeUp(0.25 + index * 0.08)}
                  className="group relative flex gap-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/80 p-4 backdrop-blur-sm transition-all hover:border-[var(--border-medium)] hover:bg-[var(--bg-elevated)]"
                >
                  <span
                    className="relative z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-xs font-bold ring-1 ring-[var(--border-subtle)] transition-transform group-hover:scale-105"
                    style={{
                      background: `color-mix(in srgb, ${item.color} 18%, var(--bg-base))`,
                      color: item.color,
                    }}
                  >
                    {item.step}
                  </span>
                  <div className="min-w-0 flex-1 pt-0.5">
                    <h3 className="mb-1 text-sm font-medium text-[var(--text-primary)]">{item.title}</h3>
                    <p className="text-xs leading-relaxed text-[var(--text-muted)]">{item.description}</p>
                  </div>
                  {index === 0 && (
                    <button
                      type="button"
                      onClick={onCreateEspacio}
                      className="shrink-0 self-center rounded-lg px-2 py-1 text-[11px] font-medium text-[var(--accent-primary)] opacity-0 transition-opacity hover:bg-[var(--accent-primary)]/10 group-hover:opacity-100"
                    >
                      Empezar →
                    </button>
                  )}
                </motion.div>
              ))}
            </div>
          </motion.div>

          <motion.div {...fadeUp(0.3)}>
            <h2 className="mb-6 text-sm font-semibold text-[var(--text-primary)]">Vistas disponibles</h2>
            <div className="grid grid-cols-2 gap-3">
              {VIEWS.map((view) => {
                const isActive = activeView === view.id;
                return (
                  <button
                    key={view.id}
                    type="button"
                    onClick={() => handleViewChange(view.id)}
                    className={`group flex flex-col gap-3 rounded-xl border p-4 text-left transition-all ${
                      isActive
                        ? 'border-[var(--accent-primary)]/40 bg-[var(--accent-primary)]/8 shadow-[0_0_0_1px_color-mix(in_srgb,var(--accent-primary)_20%,transparent)]'
                        : 'border-[var(--border-subtle)] bg-[var(--bg-base)] hover:border-[var(--border-medium)] hover:bg-[var(--bg-elevated)]'
                    }`}
                  >
                    <div
                      className="flex h-9 w-9 items-center justify-center rounded-xl transition-transform group-hover:scale-105"
                      style={{
                        background: `color-mix(in srgb, ${view.color} ${isActive ? 20 : 12}%, transparent)`,
                        color: view.color,
                      }}
                    >
                      <view.icon className="h-4 w-4" strokeWidth={1.75} />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-[var(--text-primary)]">{view.label}</p>
                      <p className="text-[11px] text-[var(--text-muted)]">{view.description}</p>
                    </div>
                    {isActive && (
                      <span className="text-[10px] font-medium text-[var(--accent-primary-hover)]">Vista activa en preview</span>
                    )}
                  </button>
                );
              })}
            </div>
          </motion.div>
        </div>
      </section>
    </div>
  );
}