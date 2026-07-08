import type { EventContentArg, EventDropArg } from '@fullcalendar/core';
import esLocale from '@fullcalendar/core/locales/es';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin from '@fullcalendar/interaction';
import FullCalendar from '@fullcalendar/react';
import timeGridPlugin from '@fullcalendar/timegrid';
import { Calendar } from 'lucide-react';
import { useMemo } from 'react';
import type { EventInput } from '@fullcalendar/core';
import type { Tarea, TareaStatus } from '../../types';
import { localTodayString, toLocalDateString } from '../../utils/dates';
import { countOverdue, countUnscheduled } from '../../utils/filters';
import { STATUS_LABELS } from '../../utils/statusConfig';
import EmptyState from '../EmptyState';
import ViewStatsBar from './ViewStatsBar';

interface CalendarViewProps {
  tareas: Tarea[];
  onDateChange: (id: string, dueDate: string | null) => void;
  onAddTask?: () => void;
}

const STATUS_EVENT_COLORS: Record<TareaStatus, string> = {
  todo: '#666666',
  in_progress: '#5E6AD2',
  done: '#22C55E',
  closed: '#888888',
};

function toEvent(tarea: Tarea): EventInput | null {
  if (!tarea.due_date) return null;
  const overdue =
    tarea.due_date < localTodayString() && tarea.status !== 'done' && tarea.status !== 'closed';
  const status = tarea.status;
  const color = overdue ? '#EF4444' : STATUS_EVENT_COLORS[status];

  return {
    id: tarea.id,
    title: tarea.title,
    start: tarea.due_date,
    allDay: true,
    backgroundColor: color,
    borderColor: color,
    extendedProps: { status, overdue },
  };
}

function renderEventContent(arg: EventContentArg) {
  const status = arg.event.extendedProps.status as TareaStatus;
  const overdue = arg.event.extendedProps.overdue as boolean;
  const color = overdue ? '#EF4444' : STATUS_EVENT_COLORS[status];

  return (
    <div className="fc-custom-event">
      <span className="fc-custom-event-dot" style={{ background: color }} />
      <span className="fc-custom-event-title">{arg.event.title}</span>
    </div>
  );
}

export default function CalendarView({ tareas, onDateChange, onAddTask }: CalendarViewProps) {
  const events = useMemo(
    () => tareas.map(toEvent).filter((e): e is EventInput => e !== null),
    [tareas],
  );

  const scheduledCount = events.length;
  const unscheduledCount = countUnscheduled(tareas);
  const overdueCount = countOverdue(tareas);

  const handleEventDrop = (info: EventDropArg) => {
    const date = info.event.start ? toLocalDateString(info.event.start) : null;
    onDateChange(info.event.id, date);
  };

  if (tareas.length === 0) {
    return (
      <EmptyState
        icon={Calendar}
        title="Calendario vacío"
        description="Crea tareas con fecha de vencimiento para verlas aquí. También puedes arrastrar eventos para reprogramarlos."
        actionLabel={onAddTask ? 'Nueva tarea' : undefined}
        onAction={onAddTask}
      />
    );
  }

  return (
    <div className="espacios-calendar px-4 pb-6">
      <div className="overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] shadow-[0_4px_24px_color-mix(in_srgb,var(--bg-base)_40%,transparent)]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-subtle)] px-4 py-3">
          <ViewStatsBar
            scheduled={scheduledCount}
            unscheduled={unscheduledCount}
            overdue={overdueCount}
          />
          <div className="flex flex-wrap gap-1.5">
            {(Object.entries(STATUS_LABELS) as [TareaStatus, string][]).map(([status, label]) => (
              <span key={status} className="inline-flex items-center gap-1 text-[10px] text-[var(--text-muted)]">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: STATUS_EVENT_COLORS[status] }}
                />
                {label}
              </span>
            ))}
          </div>
        </div>

        {scheduledCount === 0 && (
          <div className="mx-4 mt-4 rounded-lg border border-dashed border-[var(--border-medium)] bg-[var(--bg-base)] px-4 py-3 text-center text-xs leading-relaxed text-[var(--text-muted)]">
            Ninguna tarea tiene fecha de vencimiento. Asigna fechas para visualizarlas en el calendario.
          </div>
        )}

        <div className="p-3 pt-2">
          <FullCalendar
            plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
            locale={esLocale}
            initialView="dayGridMonth"
            headerToolbar={{
              left: 'prev,next today',
              center: 'title',
              right: 'dayGridMonth,timeGridWeek',
            }}
            buttonText={{ today: 'Hoy', month: 'Mes', week: 'Semana' }}
            height="auto"
            fixedWeekCount={false}
            dayMaxEvents={3}
            events={events}
            editable
            droppable
            eventDrop={handleEventDrop}
            eventContent={renderEventContent}
            eventDisplay="block"
            dayCellClassNames="fc-custom-day"
          />
        </div>
      </div>

      <style>{`
        .espacios-calendar .fc {
          --fc-border-color: var(--border-subtle);
          --fc-page-bg-color: transparent;
          --fc-neutral-bg-color: var(--bg-base);
          --fc-list-event-hover-bg-color: var(--bg-base);
          --fc-today-bg-color: color-mix(in srgb, var(--accent-primary) 10%, transparent);
          --fc-event-border-color: transparent;
          --fc-now-indicator-color: var(--accent-primary);
        }

        .espacios-calendar .fc .fc-toolbar {
          gap: 0.5rem;
          margin-bottom: 0.75rem !important;
        }

        .espacios-calendar .fc .fc-toolbar-title {
          color: var(--text-primary);
          font-size: 1rem;
          font-weight: 600;
          letter-spacing: -0.01em;
        }

        .espacios-calendar .fc .fc-button {
          border-radius: 8px;
          font-size: 0.75rem;
          font-weight: 500;
          padding: 0.35rem 0.65rem;
          text-transform: capitalize;
          transition: background 0.15s, border-color 0.15s, color 0.15s;
        }

        .espacios-calendar .fc .fc-button-primary {
          background: var(--bg-base);
          border-color: var(--border-medium);
          color: var(--text-secondary);
          box-shadow: none;
        }

        .espacios-calendar .fc .fc-button-primary:hover {
          background: var(--bg-input);
          border-color: var(--border-medium);
          color: var(--text-primary);
        }

        .espacios-calendar .fc .fc-button-primary:not(:disabled).fc-button-active,
        .espacios-calendar .fc .fc-button-primary:not(:disabled):active {
          background: color-mix(in srgb, var(--accent-primary) 18%, var(--bg-base));
          border-color: color-mix(in srgb, var(--accent-primary) 40%, transparent);
          color: var(--accent-primary-hover);
        }

        .espacios-calendar .fc .fc-button-primary:disabled {
          opacity: 0.35;
        }

        .espacios-calendar .fc .fc-col-header-cell {
          background: var(--bg-base);
          border-color: var(--border-subtle);
        }

        .espacios-calendar .fc .fc-col-header-cell-cushion {
          color: var(--text-muted);
          font-size: 0.65rem;
          font-weight: 600;
          letter-spacing: 0.04em;
          padding: 0.6rem 0.25rem;
          text-transform: uppercase;
        }

        .espacios-calendar .fc .fc-daygrid-day {
          transition: background 0.15s;
        }

        .espacios-calendar .fc .fc-daygrid-day:hover {
          background: color-mix(in srgb, var(--bg-base) 50%, transparent);
        }

        .espacios-calendar .fc .fc-daygrid-day-number {
          color: var(--text-secondary);
          font-size: 0.75rem;
          font-weight: 500;
          padding: 0.4rem 0.5rem;
        }

        .espacios-calendar .fc .fc-day-today .fc-daygrid-day-number {
          background: var(--accent-primary);
          border-radius: 6px;
          color: var(--text-on-accent);
          font-weight: 600;
          margin: 0.25rem;
          padding: 0.15rem 0.45rem;
          width: fit-content;
        }

        .espacios-calendar .fc .fc-day-other .fc-daygrid-day-number {
          color: var(--text-muted);
          opacity: 0.5;
        }

        .espacios-calendar .fc .fc-daygrid-day-frame {
          min-height: 5.5rem;
        }

        .espacios-calendar .fc .fc-daygrid-event {
          border-radius: 5px;
          margin: 1px 3px;
          padding: 0;
        }

        .espacios-calendar .fc .fc-daygrid-event .fc-event-main {
          padding: 2px 4px;
        }

        .espacios-calendar .fc .fc-daygrid-more-link {
          color: var(--accent-primary-hover);
          font-size: 0.65rem;
          font-weight: 500;
        }

        .espacios-calendar .fc .fc-daygrid-more-link:hover {
          background: color-mix(in srgb, var(--accent-primary) 12%, transparent);
          border-radius: 4px;
        }

        .espacios-calendar .fc-custom-event {
          align-items: center;
          display: flex;
          gap: 4px;
          min-width: 0;
          overflow: hidden;
        }

        .espacios-calendar .fc-custom-event-dot {
          border-radius: 50%;
          flex-shrink: 0;
          height: 5px;
          width: 5px;
        }

        .espacios-calendar .fc-custom-event-title {
          font-size: 0.65rem;
          font-weight: 500;
          line-height: 1.3;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .espacios-calendar .fc .fc-timegrid-slot-label-cushion,
        .espacios-calendar .fc .fc-timegrid-axis-cushion {
          color: var(--text-muted);
          font-size: 0.7rem;
        }

        .espacios-calendar .fc .fc-timegrid-col.fc-day-today {
          background: color-mix(in srgb, var(--accent-primary) 6%, transparent);
        }

        .espacios-calendar .fc .fc-scrollgrid {
          border-color: var(--border-subtle);
          border-radius: 8px;
          overflow: hidden;
        }

        .espacios-calendar .fc .fc-scrollgrid td,
        .espacios-calendar .fc .fc-scrollgrid th {
          border-color: var(--border-subtle);
        }
      `}</style>
    </div>
  );
}