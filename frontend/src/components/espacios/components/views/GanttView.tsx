import { addDays, format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import { Gantt, ViewMode, type Task as GanttTask } from 'gantt-task-react';
import { ChartGantt } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { Tarea, TareaStatus } from '../../types';
import { localTodayString, toLocalDateString } from '../../utils/dates';
import { countOverdue, countUnscheduled } from '../../utils/filters';
import { STATUS_LABELS } from '../../utils/statusConfig';
import EmptyState from '../EmptyState';
import ViewStatsBar from './ViewStatsBar';
import 'gantt-task-react/dist/index.css';

interface GanttViewProps {
  tareas: Tarea[];
  onDatesChange: (id: string, startDate: string | null, dueDate: string | null) => void;
  onAddTask?: () => void;
}

const VIEW_MODES = [
  { mode: ViewMode.Day, label: 'Día' },
  { mode: ViewMode.Week, label: 'Semana' },
  { mode: ViewMode.Month, label: 'Mes' },
] as const;

const STATUS_BAR_COLORS: Record<TareaStatus, { bg: string; progress: string; selected: string }> = {
  todo: { bg: '#3A3A3A', progress: '#666666', selected: '#555555' },
  in_progress: { bg: '#5E6AD2', progress: '#8B93FF', selected: '#7B85E8' },
  done: { bg: '#22C55E', progress: '#4ADE80', selected: '#34D399' },
  closed: { bg: '#555555', progress: '#888888', selected: '#777777' },
};

const OVERDUE_BAR = { bg: '#EF4444', progress: '#F87171', selected: '#DC2626' };

function toGanttTask(tarea: Tarea): GanttTask {
  const baseStart = tarea.start_date
    ? parseISO(tarea.start_date)
    : tarea.due_date
      ? parseISO(tarea.due_date)
      : parseISO(tarea.created_at.slice(0, 10));

  const end = tarea.due_date ? parseISO(tarea.due_date) : addDays(baseStart, 1);
  const start = tarea.start_date ? parseISO(tarea.start_date) : baseStart;
  const safeEnd = end >= start ? end : addDays(start, 1);

  const progress =
    tarea.status === 'done' || tarea.status === 'closed' ? 100 : tarea.status === 'in_progress' ? 50 : 0;

  const overdue =
    tarea.due_date !== null &&
    tarea.due_date < localTodayString() &&
    tarea.status !== 'done' &&
    tarea.status !== 'closed';

  const colors = overdue ? OVERDUE_BAR : STATUS_BAR_COLORS[tarea.status];

  return {
    id: tarea.id,
    name: tarea.title,
    start,
    end: safeEnd,
    progress,
    type: 'task',
    styles: {
      backgroundColor: colors.bg,
      backgroundSelectedColor: colors.selected,
      progressColor: colors.progress,
      progressSelectedColor: colors.progress,
    },
  };
}

function GanttTooltip({
  task,
}: {
  task: GanttTask;
  fontSize: string;
  fontFamily: string;
}) {
  const start = format(task.start, 'd MMM yyyy', { locale: es });
  const end = format(task.end, 'd MMM yyyy', { locale: es });

  return (
    <div className="gantt-custom-tooltip">
      <p className="gantt-custom-tooltip-title">{task.name}</p>
      <p className="gantt-custom-tooltip-dates">
        {start} → {end}
      </p>
      <div className="gantt-custom-tooltip-progress">
        <div className="gantt-custom-tooltip-progress-track">
          <div className="gantt-custom-tooltip-progress-fill" style={{ width: `${task.progress}%` }} />
        </div>
        <span>{task.progress}%</span>
      </div>
    </div>
  );
}

export default function GanttView({ tareas, onDatesChange, onAddTask }: GanttViewProps) {
  const [viewMode, setViewMode] = useState<ViewMode>(ViewMode.Week);
  const tasks = useMemo(() => tareas.map(toGanttTask), [tareas]);

  const scheduledCount = tareas.filter((t) => t.start_date || t.due_date).length;
  const unscheduledCount = countUnscheduled(tareas);
  const overdueCount = countOverdue(tareas);

  if (tareas.length === 0) {
    return (
      <EmptyState
        icon={ChartGantt}
        title="Gantt vacío"
        description="Planifica el trabajo asignando fechas de inicio y fin a tus tareas. Arrastra las barras para ajustar el cronograma."
        actionLabel={onAddTask ? 'Nueva tarea' : undefined}
        onAction={onAddTask}
      />
    );
  }

  return (
    <div className="espacios-gantt px-4 pb-6">
      <div className="overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] shadow-[0_4px_24px_color-mix(in_srgb,var(--bg-base)_40%,transparent)]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-subtle)] px-4 py-3">
          <ViewStatsBar
            scheduled={scheduledCount}
            unscheduled={unscheduledCount}
            overdue={overdueCount}
          />

          <div className="flex items-center gap-2">
            <div className="flex rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-0.5">
              {VIEW_MODES.map(({ mode, label }) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setViewMode(mode)}
                  className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                    viewMode === mode
                      ? 'bg-[var(--accent-primary)]/15 text-[var(--accent-primary-hover)]'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <Gantt
            tasks={tasks}
            viewMode={viewMode}
            locale="es"
            listCellWidth="200px"
            columnWidth={viewMode === ViewMode.Month ? 80 : viewMode === ViewMode.Week ? 55 : 40}
            rowHeight={44}
            barCornerRadius={5}
            barFill={72}
            handleWidth={8}
            fontSize="12px"
            fontFamily="inherit"
            ganttHeight={Math.min(520, Math.max(280, tasks.length * 44 + 80))}
            barBackgroundColor="var(--accent-primary)"
            barBackgroundSelectedColor="var(--accent-primary-hover)"
            barProgressColor="var(--accent-primary-hover)"
            barProgressSelectedColor="var(--accent-primary-hover)"
            todayColor="color-mix(in srgb, var(--accent-primary) 18%, transparent)"
            arrowColor="var(--text-muted)"
            TooltipContent={GanttTooltip}
            onDateChange={(task) => {
              onDatesChange(task.id, toLocalDateString(task.start), toLocalDateString(task.end));
            }}
          />
        </div>

        <div className="flex flex-wrap gap-3 border-t border-[var(--border-subtle)] px-4 py-2.5">
          {(Object.entries(STATUS_LABELS) as [TareaStatus, string][]).map(([status, label]) => (
            <span key={status} className="inline-flex items-center gap-1.5 text-[10px] text-[var(--text-muted)]">
              <span
                className="h-2 w-2 rounded-sm"
                style={{ background: STATUS_BAR_COLORS[status].bg }}
              />
              {label}
            </span>
          ))}
          <span className="inline-flex items-center gap-1.5 text-[10px] text-[var(--text-muted)]">
            <span className="h-2 w-2 rounded-sm bg-[var(--accent-red)]" />
            Atrasada
          </span>
        </div>
      </div>

      <style>{`
        .espacios-gantt ._3_ygE,
        .espacios-gantt ._3ZbQT {
          background: var(--bg-elevated);
          border-color: var(--border-subtle);
          color: var(--text-primary);
        }

        .espacios-gantt ._2QjE6,
        .espacios-gantt ._2TfEi {
          color: var(--text-muted);
          font-size: 0.65rem;
          font-weight: 600;
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }

        .espacios-gantt ._34SS0 {
          background: var(--bg-elevated);
          transition: background 0.15s;
        }

        .espacios-gantt ._34SS0:nth-of-type(even) {
          background: var(--bg-base);
        }

        .espacios-gantt ._34SS0:hover {
          background: color-mix(in srgb, var(--accent-primary) 6%, var(--bg-elevated));
        }

        .espacios-gantt ._3lLk3 {
          color: var(--text-primary);
          font-size: 0.75rem;
          font-weight: 500;
          padding-left: 0.75rem;
        }

        .espacios-gantt ._2dZTy {
          fill: var(--bg-elevated);
        }

        .espacios-gantt ._2dZTy:nth-child(even) {
          fill: var(--bg-base);
        }

        .espacios-gantt ._3rUKi,
        .espacios-gantt ._RuwuK,
        .espacios-gantt ._1rLuZ {
          stroke: var(--border-subtle);
        }

        .espacios-gantt ._9w8d5,
        .espacios-gantt ._2q1Kt {
          fill: var(--text-muted);
          font-size: 0.65rem;
          font-weight: 500;
        }

        .espacios-gantt ._3KcaM {
          fill: var(--text-primary);
          font-size: 0.75rem;
          font-weight: 500;
        }

        .espacios-gantt ._3zRJQ {
          fill: var(--text-on-accent);
          font-size: 0.65rem;
        }

        .espacios-gantt ._35nLX {
          fill: var(--bg-elevated);
          stroke: var(--border-medium);
        }

        .espacios-gantt ._3w_5u {
          fill: var(--text-muted);
        }

        .espacios-gantt ._3T42e {
          background: var(--bg-elevated);
          border: 1px solid var(--border-medium);
          border-radius: 10px;
          box-shadow: 0 8px 24px color-mix(in srgb, var(--bg-base) 50%, transparent);
          padding: 0;
        }

        .espacios-gantt ._1eT-t::-webkit-scrollbar-thumb,
        .espacios-gantt ._2k9Ys::-webkit-scrollbar-thumb {
          background: var(--scrollbar-thumb);
          border: 3px solid transparent;
          background-clip: padding-box;
          border-radius: 10px;
        }

        .espacios-gantt ._1eT-t::-webkit-scrollbar-thumb:hover,
        .espacios-gantt ._2k9Ys::-webkit-scrollbar-thumb:hover {
          background: var(--scrollbar-thumb-hover);
          background-clip: padding-box;
        }

        .espacios-gantt .gantt-custom-tooltip {
          min-width: 160px;
          padding: 10px 12px;
        }

        .espacios-gantt .gantt-custom-tooltip-title {
          color: var(--text-primary);
          font-size: 0.8rem;
          font-weight: 600;
          margin-bottom: 4px;
        }

        .espacios-gantt .gantt-custom-tooltip-dates {
          color: var(--text-muted);
          font-size: 0.7rem;
          margin-bottom: 8px;
        }

        .espacios-gantt .gantt-custom-tooltip-progress {
          align-items: center;
          display: flex;
          gap: 8px;
        }

        .espacios-gantt .gantt-custom-tooltip-progress-track {
          background: var(--bg-base);
          border-radius: 4px;
          flex: 1;
          height: 4px;
          overflow: hidden;
        }

        .espacios-gantt .gantt-custom-tooltip-progress-fill {
          background: var(--accent-primary);
          border-radius: 4px;
          height: 100%;
        }

        .espacios-gantt .gantt-custom-tooltip-progress span {
          color: var(--text-secondary);
          font-size: 0.65rem;
          font-weight: 600;
        }
      `}</style>
    </div>
  );
}