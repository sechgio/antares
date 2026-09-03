import type {
  DayCellContentArg,
  DayHeaderContentArg,
  EventApi,
  EventClickArg,
  EventContentArg,
  EventDropArg,
  EventInput,
} from '@fullcalendar/core';
import type { EventResizeDoneArg } from '@fullcalendar/interaction';
import esLocale from '@fullcalendar/core/locales/es';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin, { type DateClickArg } from '@fullcalendar/interaction';
import FullCalendar from '@fullcalendar/react';
import timeGridPlugin from '@fullcalendar/timegrid';
import { WithHoverTooltip } from '@/components/ui/HoverTooltip';
import { Check, Plus } from 'lucide-react';
import { useCallback, useMemo } from 'react';
import type { BoardColumn, Tarea, TareaStatus } from '../../types';
import { localTodayString, toLocalDateString } from '../../utils/dates';
import { countOverdue, countUnscheduled } from '../../utils/filters';
import { columnColor, columnIsDone } from '../../utils/statusConfig';

interface CalendarViewProps {
  tareas: Tarea[];
  columns?: BoardColumn[];
  onDateChange: (id: string, dueDate: string | null) => void;
  onDatesChange?: (id: string, startDate: string | null, dueDate: string | null) => void;
  onAddTask?: () => void;
  onAddTaskOnDate?: (dueDate: string) => void;
  onEditTask?: (tarea: Tarea) => void;
}

const OVERDUE_COLOR = 'var(--accent-red)';

const WEEKDAY_LONG = new Intl.DateTimeFormat('es', { weekday: 'long' });
const DAY_MONTH = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short' });

function softSurface(hex: string, amount = 22): string {
  return `color-mix(in srgb, ${hex} ${amount}%, var(--bg-elevated))`;
}

function statusAccent(status: TareaStatus, overdue: boolean, columns: BoardColumn[] = []): string {
  if (overdue) return OVERDUE_COLOR;
  return columnColor(columns, status);
}

function exclusiveEndIso(inclusiveEnd: string): string {
  const [y, m, d] = inclusiveEnd.split('-').map(Number);
  const date = new Date(y, (m ?? 1) - 1, d ?? 1);
  date.setDate(date.getDate() + 1);
  return toLocalDateString(date);
}

function toEvent(tarea: Tarea, columns: BoardColumn[]): EventInput | null {
  if (!tarea.due_date && !tarea.start_date) return null;

  let start = tarea.start_date ?? tarea.due_date!;
  let inclusiveEnd = tarea.due_date ?? tarea.start_date!;
  if (inclusiveEnd < start) {
    const tmp = start;
    start = inclusiveEnd;
    inclusiveEnd = tmp;
  }
  const end = exclusiveEndIso(inclusiveEnd);

  const overdue =
    tarea.due_date !== null &&
    tarea.due_date < localTodayString() &&
    !columnIsDone(columns, tarea.status);
  const status = tarea.status;
  const accent = statusAccent(status, overdue, columns);

  return {
    id: tarea.id,
    title: tarea.title,
    start,
    end,
    allDay: true,
    backgroundColor: softSurface(accent, 28),
    borderColor: `color-mix(in srgb, ${accent} 35%, transparent)`,
    textColor: accent,
    extendedProps: { status, overdue, accent, tarea, inclusiveEnd, isDone: columnIsDone(columns, status) },
  };
}

function StatusGlyph({ status, color, isDone }: { status: TareaStatus; color: string; isDone?: boolean }) {
  if (isDone || status === 'done' || status === 'closed') {
    return (
      <span className="fc-chip-glyph" style={{ background: color }}>
        <Check className="h-2 w-2" strokeWidth={3} />
      </span>
    );
  }
  return <span className="fc-chip-dot" style={{ background: color }} />;
}

function renderEventContent(arg: EventContentArg) {
  const status = (arg.event.extendedProps.status as TareaStatus) || 'todo';
  const overdue = Boolean(arg.event.extendedProps.overdue);
  const accent = (arg.event.extendedProps.accent as string) || statusAccent(status, overdue);
  const isDone = Boolean(arg.event.extendedProps.isDone);

  return (
    <div className="fc-task-chip" style={{ background: softSurface(accent, 28), color: accent }}>
      <StatusGlyph status={status} color={accent} isDone={isDone} />
      <span className="fc-task-chip-title">{arg.event.title}</span>
    </div>
  );
}

function renderDayHeader(arg: DayHeaderContentArg) {
  const isWeek = arg.view.type === 'timeGridWeek';
  const isToday = toLocalDateString(arg.date) === localTodayString();

  if (isWeek) {
    const weekday = WEEKDAY_LONG.format(arg.date);
    const dayMonth = DAY_MONTH.format(arg.date).replace('.', '');
    return (
      <div className={`fc-week-head${isToday ? ' is-today' : ''}`}>
        <span className="fc-week-head-name">{weekday}</span>
        <span className="fc-week-head-date">{dayMonth}</span>
      </div>
    );
  }

  const label = String(arg.text ?? '').toLocaleLowerCase('es');
  return <span className="fc-day-name">{label}</span>;
}

export default function CalendarView({
  tareas,
  columns = [],
  onDateChange,
  onDatesChange,
  onAddTask,
  onAddTaskOnDate,
  onEditTask,
}: CalendarViewProps) {
  const tareasById = useMemo(() => new Map(tareas.map((t) => [t.id, t])), [tareas]);

  const events = useMemo(
    () => tareas.map((t) => toEvent(t, columns)).filter((e): e is EventInput => e !== null),
    [tareas, columns],
  );

  const scheduledCount = events.length;
  const unscheduledCount = countUnscheduled(tareas, columns);
  const overdueCount = countOverdue(tareas, columns);

  const openCreateForDate = useCallback(
    (date: Date | string) => {
      const dueDate = typeof date === 'string' ? date : toLocalDateString(date);
      if (onAddTaskOnDate) {
        onAddTaskOnDate(dueDate);
        return;
      }
      onAddTask?.();
    },
    [onAddTask, onAddTaskOnDate],
  );

  const persistEventDates = (event: EventApi) => {
    if (!event.start) {
      onDateChange(event.id, null);
      return;
    }

    const start = toLocalDateString(event.start);
    let due = start;
    if (event.end) {
      const end = new Date(event.end);
      end.setDate(end.getDate() - 1);
      due = toLocalDateString(end);
    }

    if (onDatesChange) {
      onDatesChange(event.id, start, due);
      return;
    }
    onDateChange(event.id, due);
  };

  const handleEventDrop = (info: EventDropArg) => {
    persistEventDates(info.event);
  };

  const handleEventResize = (info: EventResizeDoneArg) => {
    persistEventDates(info.event);
  };

  const handleDateClick = (info: DateClickArg) => {
    openCreateForDate(info.date);
  };

  const handleEventClick = (info: EventClickArg) => {
    info.jsEvent.preventDefault();
    info.jsEvent.stopPropagation();
    const tarea =
      (info.event.extendedProps.tarea as Tarea | undefined) ?? tareasById.get(info.event.id);
    if (tarea && onEditTask) {
      onEditTask(tarea);
    }
  };

  const renderDayCell = useCallback(
    (arg: DayCellContentArg) => {
      if (arg.view.type === 'timeGridWeek') {
        return <span className="fc-day-num-hidden" aria-hidden />;
      }

      const dateStr = toLocalDateString(arg.date);
      return (
        <div className="fc-day-cell-head">
          {(onAddTaskOnDate || onAddTask) && (
            <WithHoverTooltip label="Crear tarea" placement="bottom">
              <button
                type="button"
                className="fc-day-add"
                aria-label={`Crear tarea el ${dateStr}`}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  openCreateForDate(dateStr);
                }}
              >
                <Plus className="h-3 w-3" strokeWidth={2.5} />
              </button>
            </WithHoverTooltip>
          )}
          <span className="fc-day-num">{arg.dayNumberText}</span>
        </div>
      );
    },
    [onAddTask, onAddTaskOnDate, openCreateForDate],
  );

  return (
    <div className="espacios-calendar flex h-full min-h-0 flex-1 flex-col bg-[var(--bg-elevated)]">
      {scheduledCount === 0 && tareas.length > 0 && (
        <div className="shrink-0 border-b border-dashed border-[var(--border-subtle)] px-4 py-2 text-center text-xs text-[var(--text-muted)]">
          Ninguna tarea tiene fecha. Haz clic en un día o en el + para crear/asignar fechas.
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="relative min-h-0 min-w-0 flex-1 px-1 pb-1 pt-0.5 sm:px-2 sm:pb-2">
          <FullCalendar
            plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
            locale={esLocale}
            firstDay={0}
            initialView="dayGridMonth"
            headerToolbar={{
              left: 'today dayGridMonth,timeGridWeek prev,next',
              center: 'title',
              right: '',
            }}
            buttonText={{ today: 'Hoy', month: 'Mes', week: 'Semana' }}
            height="100%"
            expandRows
            fixedWeekCount
            dayMaxEvents={4}
            allDaySlot
            allDayText="Todo el día"
            slotMinTime="00:00:00"
            slotMaxTime="24:00:00"
            slotDuration="01:00:00"
            slotLabelInterval="01:00:00"
            slotLabelFormat={{ hour: 'numeric', meridiem: 'short', hour12: true }}
            nowIndicator
            events={events}
            editable
            droppable
            eventDurationEditable={Boolean(onDatesChange)}
            eventStartEditable
            dateClick={handleDateClick}
            eventClick={handleEventClick}
            eventDrop={handleEventDrop}
            eventResize={handleEventResize}
            eventContent={renderEventContent}
            eventDisplay="block"
            dayHeaderContent={renderDayHeader}
            dayCellContent={renderDayCell}
            dayHeaderFormat={{ weekday: 'short' }}
            views={{
              timeGridWeek: {
                dayHeaderFormat: { weekday: 'long', day: 'numeric', month: 'short' },
                dayMaxEvents: false,
              },
              dayGridMonth: {
                dayHeaderFormat: { weekday: 'short' },
              },
            }}
          />
        </div>

        <aside className="hidden shrink-0 flex-row items-center justify-end gap-4 border-t border-[var(--border-subtle)] px-3 py-1.5 sm:flex">
          {overdueCount > 0 && (
            <div
              className="inline-flex items-center gap-1.5 text-[11px] text-[var(--accent-red)]"
              title={`${overdueCount} retrasadas`}
            >
              <span className="font-semibold">{overdueCount}</span>
              <span className="text-[var(--text-muted)]">retrasadas</span>
            </div>
          )}
          {unscheduledCount > 0 && (
            <div
              className="inline-flex items-center gap-1.5 text-[11px] text-[var(--text-secondary)]"
              title={`${unscheduledCount} sin programar`}
            >
              <span className="font-semibold">{unscheduledCount}</span>
              <span className="text-[var(--text-muted)]">sin programar</span>
            </div>
          )}
          {overdueCount === 0 && unscheduledCount === 0 && scheduledCount > 0 && (
            <div
              className="inline-flex items-center gap-1.5 text-[11px] text-[var(--text-secondary)]"
              title={`${scheduledCount} programadas`}
            >
              <span className="font-semibold">{scheduledCount}</span>
              <span className="text-[var(--text-muted)]">programadas</span>
            </div>
          )}
        </aside>
      </div>

      <style>{`
        .espacios-calendar .fc {
          --fc-border-color: color-mix(in srgb, var(--border-subtle) 80%, transparent);
          --fc-page-bg-color: transparent;
          --fc-neutral-bg-color: var(--bg-base);
          --fc-list-event-hover-bg-color: var(--bg-base);
          --fc-today-bg-color: transparent;
          --fc-event-border-color: transparent;
          --fc-now-indicator-color: var(--accent-red, #ef4444);
          --fc-highlight-color: color-mix(in srgb, var(--accent-primary) 8%, transparent);
          --weekend-hatch: repeating-linear-gradient(
            -45deg,
            transparent,
            transparent 3px,
            color-mix(in srgb, var(--text-muted) 7%, transparent) 3px,
            color-mix(in srgb, var(--text-muted) 7%, transparent) 4px
          );
          font-family: inherit;
          height: 100% !important;
          display: flex;
          flex-direction: column;
          min-height: 0;
        }

        .espacios-calendar .fc .fc-view-harness {
          flex: 1 1 auto;
          min-height: 0 !important;
          height: auto !important;
        }

        .espacios-calendar .fc .fc-view-harness-active > .fc-view {
          position: absolute;
          inset: 0;
        }

        /* ── Toolbar ── */
        .espacios-calendar .fc .fc-toolbar {
          align-items: center;
          display: flex;
          flex-wrap: wrap;
          flex-shrink: 0;
          gap: 0.5rem;
          margin-bottom: 0.35rem !important;
          padding: 0.3rem 0.25rem 0.2rem;
        }

        .espacios-calendar .fc .fc-toolbar-chunk {
          align-items: center;
          display: flex;
          gap: 0.35rem;
        }

        .espacios-calendar .fc .fc-toolbar-title {
          color: var(--text-primary);
          font-size: 0.95rem;
          font-weight: 600;
          letter-spacing: -0.01em;
          text-transform: lowercase;
        }

        .espacios-calendar .fc .fc-button {
          border-radius: 8px;
          cursor: pointer;
          font-size: 0.75rem;
          font-weight: 500;
          padding: 0.3rem 0.6rem;
          text-transform: none;
          transition: background 0.15s, border-color 0.15s, color 0.15s;
        }

        .espacios-calendar .fc .fc-button-primary {
          background: transparent;
          border: 1px solid var(--border-medium);
          color: var(--text-secondary);
          box-shadow: none;
        }

        .espacios-calendar .fc .fc-button-primary:hover {
          background: var(--bg-base);
          border-color: var(--border-medium);
          color: var(--text-primary);
        }

        .espacios-calendar .fc .fc-button-primary:not(:disabled).fc-button-active,
        .espacios-calendar .fc .fc-button-primary:not(:disabled):active {
          background: color-mix(in srgb, var(--accent-primary) 14%, var(--bg-base));
          border-color: color-mix(in srgb, var(--accent-primary) 35%, transparent);
          color: var(--accent-primary-hover);
        }

        .espacios-calendar .fc .fc-button-primary:disabled {
          opacity: 0.35;
        }

        .espacios-calendar .fc .fc-button-group {
          display: inline-flex;
        }

        .espacios-calendar .fc .fc-button-group > .fc-button {
          border-radius: 0;
        }

        .espacios-calendar .fc .fc-button-group > .fc-button:first-child {
          border-radius: 8px 0 0 8px;
        }

        .espacios-calendar .fc .fc-button-group > .fc-button:last-child {
          border-radius: 0 8px 8px 0;
        }

        .espacios-calendar .fc .fc-prev-button,
        .espacios-calendar .fc .fc-next-button {
          min-width: 2rem;
          padding-left: 0.4rem;
          padding-right: 0.4rem;
        }

        /* ── Shared grid shell ── */
        .espacios-calendar .fc .fc-scrollgrid {
          border: none;
          height: 100%;
          width: 100%;
        }

        .espacios-calendar .fc .fc-scrollgrid-section > td {
          border: none;
        }

        .espacios-calendar .fc .fc-col-header {
          width: 100% !important;
        }

        .espacios-calendar .fc .fc-col-header-cell {
          background: transparent;
          border-color: var(--border-subtle);
          box-sizing: border-box;
        }

        .espacios-calendar .fc .fc-col-header-cell-cushion {
          display: block;
          padding: 0.4rem 0.2rem 0.45rem;
          width: 100%;
        }

        .espacios-calendar .fc-day-name {
          color: var(--text-muted);
          display: block;
          font-size: 0.72rem;
          font-weight: 500;
          letter-spacing: 0.01em;
          text-align: center;
          text-transform: lowercase;
        }

        /* Week headers: "domingo" + "5 jul." like reference */
        .espacios-calendar .fc-week-head {
          align-items: flex-start;
          display: flex;
          flex-direction: column;
          gap: 0.15rem;
          padding: 0.15rem 0.35rem;
          text-align: left;
        }

        .espacios-calendar .fc-week-head-name {
          color: var(--text-secondary);
          font-size: 0.72rem;
          font-weight: 500;
          line-height: 1.2;
          text-transform: lowercase;
        }

        .espacios-calendar .fc-week-head-date {
          color: var(--text-muted);
          font-size: 0.7rem;
          font-weight: 500;
          line-height: 1.2;
        }

        .espacios-calendar .fc-week-head.is-today .fc-week-head-name,
        .espacios-calendar .fc-week-head.is-today .fc-week-head-date {
          color: var(--accent-red, #ef4444);
          font-weight: 600;
        }

        .espacios-calendar .fc .fc-scrollgrid td,
        .espacios-calendar .fc .fc-scrollgrid th {
          border-color: color-mix(in srgb, var(--border-subtle) 90%, transparent);
        }

        /* ════════════════════════════════════════
           MONTH VIEW — equal day boxes
           ════════════════════════════════════════ */
        .espacios-calendar .fc-dayGridMonth-view .fc-scrollgrid-section-header > th,
        .espacios-calendar .fc-dayGridMonth-view .fc-scrollgrid-section-body > td {
          height: 100%;
        }

        .espacios-calendar .fc-dayGridMonth-view .fc-scroller {
          height: 100% !important;
          overflow: hidden !important;
        }

        .espacios-calendar .fc-dayGridMonth-view .fc-scroller-liquid-absolute {
          position: absolute;
          inset: 0;
        }

        .espacios-calendar .fc-dayGridMonth-view .fc-scrollgrid-sync-table {
          border-collapse: separate;
          border-spacing: 0;
          height: 100% !important;
          table-layout: fixed !important;
          width: 100% !important;
        }

        .espacios-calendar .fc-dayGridMonth-view .fc-daygrid-body {
          height: 100% !important;
          width: 100% !important;
        }

        .espacios-calendar .fc-dayGridMonth-view .fc-daygrid-body table {
          height: 100% !important;
          table-layout: fixed !important;
          width: 100% !important;
        }

        /* Month has no time-axis column: 7 equal day columns */
        .espacios-calendar .fc-dayGridMonth-view .fc-col-header-cell {
          width: calc(100% / 7) !important;
        }

        .espacios-calendar .fc-dayGridMonth-view .fc-daygrid-day {
          cursor: pointer;
          height: calc(100% / 6);
          transition: background 0.12s;
          vertical-align: top;
          width: calc(100% / 7) !important;
        }

        .espacios-calendar .fc-dayGridMonth-view .fc-daygrid-day-frame {
          display: flex;
          flex-direction: column;
          height: 100%;
          min-height: 0;
          position: relative;
        }

        .espacios-calendar .fc-dayGridMonth-view .fc-daygrid-day:hover {
          background: color-mix(in srgb, var(--bg-base) 55%, transparent);
        }

        .espacios-calendar .fc-dayGridMonth-view .fc-day-sat .fc-daygrid-day-frame,
        .espacios-calendar .fc-dayGridMonth-view .fc-day-sun .fc-daygrid-day-frame,
        .espacios-calendar .fc-dayGridMonth-view .fc-day-sat.fc-col-header-cell,
        .espacios-calendar .fc-dayGridMonth-view .fc-day-sun.fc-col-header-cell {
          background-image: var(--weekend-hatch);
        }

        .espacios-calendar .fc-dayGridMonth-view .fc-daygrid-day-top {
          display: flex;
          flex-direction: row;
          flex-shrink: 0;
          justify-content: flex-end;
          position: relative;
        }

        .espacios-calendar .fc-dayGridMonth-view .fc-daygrid-day-number {
          padding: 0;
          width: 100%;
        }

        .espacios-calendar .fc-day-cell-head {
          align-items: center;
          display: flex;
          justify-content: flex-end;
          min-height: 1.5rem;
          padding: 0.3rem 0.35rem 0.1rem;
          position: relative;
          width: 100%;
        }

        .espacios-calendar .fc-day-add {
          align-items: center;
          background: var(--bg-elevated);
          border: 1px solid var(--border-medium);
          border-radius: 6px;
          color: var(--text-secondary);
          cursor: pointer;
          display: inline-flex;
          height: 1.25rem;
          justify-content: center;
          left: 0.3rem;
          opacity: 0;
          position: absolute;
          top: 0.3rem;
          transition: opacity 0.12s, background 0.12s, color 0.12s, border-color 0.12s;
          width: 1.25rem;
          z-index: 2;
        }

        .espacios-calendar .fc-dayGridMonth-view .fc-daygrid-day:hover .fc-day-add,
        .espacios-calendar .fc-day-add:focus-visible {
          opacity: 1;
        }

        .espacios-calendar .fc-day-add:hover {
          background: var(--text-primary);
          border-color: var(--text-primary);
          color: var(--bg-elevated);
        }

        .espacios-calendar .fc-day-num {
          color: var(--text-muted);
          display: inline-flex;
          font-size: 0.72rem;
          font-weight: 500;
          justify-content: center;
          line-height: 1;
          min-width: 1.25rem;
        }

        .espacios-calendar .fc-dayGridMonth-view .fc-day-today {
          background: transparent !important;
        }

        .espacios-calendar .fc-dayGridMonth-view .fc-day-today .fc-daygrid-day-frame::before {
          background: var(--accent-red, #ef4444);
          content: '';
          height: 100%;
          left: 50%;
          opacity: 0.85;
          pointer-events: none;
          position: absolute;
          top: 0;
          transform: translateX(-50%);
          width: 1px;
          z-index: 1;
        }

        .espacios-calendar .fc-dayGridMonth-view .fc-day-today .fc-day-num {
          align-items: center;
          background: var(--accent-red, #ef4444);
          border-radius: 999px;
          color: #fff;
          font-weight: 600;
          height: 1.4rem;
          min-width: 1.4rem;
          padding: 0 0.25rem;
          position: relative;
          z-index: 2;
        }

        .espacios-calendar .fc-dayGridMonth-view .fc-day-other .fc-day-num {
          opacity: 0.4;
        }

        .espacios-calendar .fc-dayGridMonth-view .fc-daygrid-day-events {
          flex: 1 1 auto;
          margin-top: 0.1rem;
          min-height: 0 !important;
          position: relative;
          z-index: 2;
        }

        .espacios-calendar .fc-dayGridMonth-view .fc-daygrid-day-bottom {
          flex-shrink: 0;
        }

        /* ════════════════════════════════════════
           WEEK VIEW — equal columns, aligned borders
           ════════════════════════════════════════ */
        .espacios-calendar .fc-timeGridWeek-view {
          /* Fixed axis width so day cols share the rest equally */
          --fc-week-axis-w: 3.75rem;
        }

        .espacios-calendar .fc-timeGridWeek-view .fc-scrollgrid {
          height: 100%;
          width: 100%;
        }

        /*
         * Critical: never force day cols to 100%/7 — that ignores the axis column
         * and misaligns header vs all-day vs time slots.
         * Use fixed tables + fixed axis; day columns share remaining width equally.
         */
        .espacios-calendar .fc-timeGridWeek-view .fc-scrollgrid-sync-table,
        .espacios-calendar .fc-timeGridWeek-view .fc-col-header,
        .espacios-calendar .fc-timeGridWeek-view .fc-daygrid-body > table,
        .espacios-calendar .fc-timeGridWeek-view .fc-timegrid-body > table,
        .espacios-calendar .fc-timeGridWeek-view .fc-timegrid-slots > table,
        .espacios-calendar .fc-timeGridWeek-view .fc-timegrid-cols > table {
          border-collapse: separate !important;
          border-spacing: 0 !important;
          table-layout: fixed !important;
          width: 100% !important;
        }

        /* Axis (hours / "Todo el día") — same width in every section */
        .espacios-calendar .fc-timeGridWeek-view .fc-timegrid-axis,
        .espacios-calendar .fc-timeGridWeek-view th.fc-timegrid-axis,
        .espacios-calendar .fc-timeGridWeek-view td.fc-timegrid-axis,
        .espacios-calendar .fc-timeGridWeek-view .fc-scrollgrid-shrink,
        .espacios-calendar .fc-timeGridWeek-view col.fc-day-fc-day,
        .espacios-calendar .fc-timeGridWeek-view .fc-scrollgrid-sync-table > colgroup > col:first-child {
          box-sizing: border-box !important;
          max-width: var(--fc-week-axis-w) !important;
          min-width: var(--fc-week-axis-w) !important;
          width: var(--fc-week-axis-w) !important;
        }

        /* Day columns: equal share of (100% − axis). Do NOT set 100%/7 of full table. */
        .espacios-calendar .fc-timeGridWeek-view .fc-col-header-cell:not(.fc-timegrid-axis),
        .espacios-calendar .fc-timeGridWeek-view .fc-daygrid-day,
        .espacios-calendar .fc-timeGridWeek-view .fc-timegrid-col {
          box-sizing: border-box !important;
          width: auto !important;
        }

        .espacios-calendar .fc-timeGridWeek-view .fc-scrollgrid-sync-table > colgroup > col:not(:first-child) {
          width: auto !important;
        }

        /* Vertical borders: same on header, all-day and slots */
        .espacios-calendar .fc-timeGridWeek-view .fc-scrollgrid th,
        .espacios-calendar .fc-timeGridWeek-view .fc-scrollgrid td {
          border-color: color-mix(in srgb, var(--border-subtle) 90%, transparent);
          border-style: solid;
          border-width: 0 1px 1px 0;
          box-sizing: border-box;
        }

        .espacios-calendar .fc-timeGridWeek-view .fc-scrollgrid .fc-timegrid-axis,
        .espacios-calendar .fc-timeGridWeek-view .fc-scrollgrid .fc-scrollgrid-shrink {
          border-left-width: 0;
        }

        /* All-day row: natural height, not stretched */
        .espacios-calendar .fc-timeGridWeek-view .fc-daygrid-body {
          height: auto !important;
          width: 100% !important;
        }

        .espacios-calendar .fc-timeGridWeek-view .fc-daygrid-day {
          height: auto !important;
          vertical-align: top;
        }

        .espacios-calendar .fc-timeGridWeek-view .fc-daygrid-day-frame {
          display: block;
          height: auto;
          min-height: 2.5rem;
        }

        .espacios-calendar .fc-timeGridWeek-view .fc-daygrid-day-events {
          margin: 2px 0;
          min-height: 1.5rem !important;
        }

        .espacios-calendar .fc-timeGridWeek-view .fc-daygrid-event-harness {
          margin-bottom: 2px;
        }

        /*
         * Scroll: only the time-slot body scrolls vertically.
         * Header + all-day stay locked so their column lines stay aligned.
         * scrollbar-gutter reserves space so body width matches header.
         */
        .espacios-calendar .fc-timeGridWeek-view .fc-scroller {
          scrollbar-gutter: stable;
        }

        .espacios-calendar .fc-timeGridWeek-view .fc-scrollgrid-section-header .fc-scroller,
        .espacios-calendar .fc-timeGridWeek-view .fc-daygrid-body {
          overflow: hidden !important;
        }

        .espacios-calendar .fc-timeGridWeek-view .fc-timegrid-body {
          min-height: 100%;
        }

        .espacios-calendar .fc-timeGridWeek-view .fc-timegrid-body > .fc-scroller,
        .espacios-calendar .fc-timeGridWeek-view .fc-scrollgrid-section-liquid .fc-scroller {
          overflow-y: auto !important;
          overflow-x: hidden !important;
        }

        .espacios-calendar .fc-timeGridWeek-view .fc-timegrid-slots table {
          height: auto !important;
        }

        .espacios-calendar .fc-timeGridWeek-view .fc-timegrid-slot {
          height: 2.4rem;
        }

        .espacios-calendar .fc-timeGridWeek-view .fc-timegrid-slot-label {
          vertical-align: top;
        }

        .espacios-calendar .fc-timeGridWeek-view .fc-timegrid-slot-label-cushion,
        .espacios-calendar .fc-timeGridWeek-view .fc-timegrid-axis-cushion {
          color: var(--text-muted);
          font-size: 0.68rem;
          font-weight: 500;
        }

        .espacios-calendar .fc-timeGridWeek-view .fc-timegrid-axis-frame {
          justify-content: flex-start;
        }

        .espacios-calendar .fc-timeGridWeek-view .fc-timegrid-divider {
          border-color: var(--border-subtle);
          padding: 0;
        }

        .espacios-calendar .fc-timeGridWeek-view .fc-timegrid-col.fc-day-sat,
        .espacios-calendar .fc-timeGridWeek-view .fc-timegrid-col.fc-day-sun,
        .espacios-calendar .fc-timeGridWeek-view .fc-day-sat.fc-col-header-cell,
        .espacios-calendar .fc-timeGridWeek-view .fc-day-sun.fc-col-header-cell,
        .espacios-calendar .fc-timeGridWeek-view .fc-day-sat .fc-daygrid-day-frame,
        .espacios-calendar .fc-timeGridWeek-view .fc-day-sun .fc-daygrid-day-frame {
          background-image: none;
        }

        .espacios-calendar .fc-timeGridWeek-view .fc-timegrid-col.fc-day-today {
          background: color-mix(in srgb, var(--accent-primary) 4%, transparent);
        }

        .espacios-calendar .fc-timeGridWeek-view .fc-col-header-cell.fc-day-today {
          background: transparent;
        }

        .espacios-calendar .fc-timeGridWeek-view .fc-timegrid-now-indicator-line {
          border-color: var(--accent-red, #ef4444);
        }

        .espacios-calendar .fc-timeGridWeek-view .fc-timegrid-now-indicator-arrow {
          border-color: var(--accent-red, #ef4444);
          border-top-color: transparent;
          border-bottom-color: transparent;
        }

        /* All-day label column text */
        .espacios-calendar .fc-timeGridWeek-view .fc-timegrid-axis-cushion {
          max-width: var(--fc-week-axis-w);
          padding: 0.25rem 0.3rem;
          white-space: normal;
          word-break: break-word;
        }

        .espacios-calendar .fc-day-num-hidden {
          display: none;
        }

        /* ── Task chips (month + week all-day) ── */
        .espacios-calendar .fc .fc-daygrid-event {
          background: transparent !important;
          border: none !important;
          border-radius: 4px;
          cursor: pointer;
          margin: 1px 3px;
          padding: 0;
        }

        .espacios-calendar .fc .fc-daygrid-event .fc-event-main {
          color: inherit;
          padding: 0;
        }

        .espacios-calendar .fc .fc-daygrid-event:hover .fc-task-chip {
          filter: brightness(1.06);
        }

        .espacios-calendar .fc .fc-daygrid-block-event .fc-event-main {
          padding: 0;
        }

        /* Week: solid bars like the reference */
        .espacios-calendar .fc-timeGridWeek-view .fc-daygrid-event {
          border: 1px solid transparent !important;
          border-radius: 3px;
          margin: 1px 2px;
        }

        .espacios-calendar .fc-timeGridWeek-view .fc-task-chip {
          border-radius: 3px;
          min-height: 1.35rem;
          padding: 2px 6px;
        }

        .espacios-calendar .fc-task-chip {
          align-items: center;
          border-radius: 6px;
          display: flex;
          gap: 5px;
          min-width: 0;
          overflow: hidden;
          padding: 3px 6px 3px 5px;
        }

        .espacios-calendar .fc-chip-dot {
          border-radius: 50%;
          flex-shrink: 0;
          height: 7px;
          width: 7px;
        }

        .espacios-calendar .fc-chip-glyph {
          align-items: center;
          border-radius: 50%;
          color: #fff;
          display: inline-flex;
          flex-shrink: 0;
          height: 11px;
          justify-content: center;
          width: 11px;
        }

        .espacios-calendar .fc-task-chip-title {
          font-size: 0.7rem;
          font-weight: 500;
          line-height: 1.25;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .espacios-calendar .fc .fc-daygrid-more-link {
          color: var(--text-muted);
          font-size: 0.65rem;
          font-weight: 500;
          margin: 1px 4px;
          padding: 1px 4px;
        }

        .espacios-calendar .fc .fc-daygrid-more-link:hover {
          background: color-mix(in srgb, var(--accent-primary) 12%, transparent);
          border-radius: 4px;
          color: var(--accent-primary-hover);
        }
      `}</style>
    </div>
  );
}
