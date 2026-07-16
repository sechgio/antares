import { WithHoverTooltip } from '@/components/ui/HoverTooltip';
import { ChartGantt, ChevronLeft, ChevronRight, Minus, Plus } from 'lucide-react';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BoardColumn, Tarea, TareaStatus } from '../../types';
import { localTodayString } from '../../utils/dates';
import { countOverdue, countUnscheduled } from '../../utils/filters';
import {
  addDaysIso,
  applyGanttDragDelta,
  buildDays,
  buildGanttBars,
  buildWeekGroups,
  clampGanttColW,
  computeVisibleRange,
  diffDaysIso,
  formatDayHeader,
  GANTT_COL_W_MAX,
  GANTT_COL_W_MIN,
  GANTT_ZOOM_PRESET_COL,
  laneCount,
  parseLocalDate,
  resolveGanttColW,
  resolveGanttMinSpan,
  zoomLevelFromColW,
  type GanttBar,
  type GanttDragMode,
  type GanttZoomLevel,
} from '../../utils/ganttLayout';
import { columnColor, columnIsDone, pickerColumns } from '../../utils/statusConfig';
import EmptyState from '../EmptyState';
import ViewStatsBar from './ViewStatsBar';

interface GanttViewProps {
  tareas: Tarea[];
  columns?: BoardColumn[];
  onDatesChange: (id: string, startDate: string | null, dueDate: string | null) => void;
  onAddTask?: () => void;
  onAddTaskOnDate?: (dueDate: string) => void;
  onEditTask?: (tarea: Tarea) => void;
}

type ZoomLevel = GanttZoomLevel;

const COL_W_MIN = GANTT_COL_W_MIN;
const COL_W_MAX = GANTT_COL_W_MAX;
const COL_W_WHEEL_STEP = 4;

const LANE_HEIGHT = 40;
const BAR_HEIGHT = 26;
const HEADER_WEEK_H = 28;
const HEADER_DAY_H = 36;
const MIN_LANES = 4;
const OVERDUE_COLOR = 'var(--accent-red)';

const DATE_SHORT = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short' });

function barAccent(bar: GanttBar, columns: BoardColumn[] = []): string {
  if (bar.overdue) return OVERDUE_COLOR;
  return columnColor(columns, bar.tarea.status);
}

function barSurface(accent: string): string {
  return `color-mix(in srgb, ${accent} 16%, var(--bg-elevated))`;
}

/** e.g. "jul. 5 – jul. 6 (2d)" */
function formatRangeDuration(start: string, end: string): string {
  const a = DATE_SHORT.format(parseLocalDate(start)).toLowerCase();
  const b = DATE_SHORT.format(parseLocalDate(end)).toLowerCase();
  const days = diffDaysIso(start, end) + 1;
  return `${a} – ${b} (${days}d)`;
}

function StatusDot({ status, color, isDone }: { status: TareaStatus; color: string; isDone?: boolean }) {
  if (isDone || status === 'done' || status === 'closed') {
    return (
      <span
        className="inline-flex h-2.5 w-2.5 shrink-0 items-center justify-center rounded-full"
        style={{ background: color }}
        aria-hidden
      >
        <span className="h-1 w-1 rounded-full bg-white" />
      </span>
    );
  }
  return <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} aria-hidden />;
}

export default function GanttView({
  tareas,
  columns = [],
  onDatesChange,
  onAddTask,
  onAddTaskOnDate,
  onEditTask,
}: GanttViewProps) {
  const [zoom, setZoom] = useState<ZoomLevel>('day');
  /** null = use preset for current zoom; number = free zoom (Ctrl+rueda / +/-). */
  const [colWManual, setColWManual] = useState<number | null>(null);
  const [rangeOffset, setRangeOffset] = useState(0);
  const [hoverDate, setHoverDate] = useState<string | null>(null);
  const [hoveredBarId, setHoveredBarId] = useState<string | null>(null);
  const [viewportW, setViewportW] = useState(0);
  const [viewportH, setViewportH] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const didScrollToday = useRef(false);
  /** Keep scroll anchored under the cursor while free-zooming. */
  const zoomAnchorRef = useRef<{ dayAtMouse: number; viewRatio: number } | null>(null);
  const colWRef = useRef(GANTT_ZOOM_PRESET_COL.day);
  const dragRef = useRef<{
    id: string;
    mode: GanttDragMode;
    startX: number;
    originStart: string;
    originEnd: string;
    moved: boolean;
  } | null>(null);
  const [dragPreview, setDragPreview] = useState<{
    id: string;
    mode: GanttDragMode;
    start: string;
    end: string;
  } | null>(null);

  const today = localTodayString();

  const bars = useMemo(() => buildGanttBars(tareas, today, columns), [tareas, today, columns]);

  // Honor Día/Semana/Mes presets exactly. Stretching columns to fill the viewport used to
  // force the same width for every preset on wide screens / short task ranges.
  const colW = useMemo(() => resolveGanttColW(zoom, colWManual), [zoom, colWManual]);

  const baseRange = useMemo(() => {
    const { padDays, minSpanDays } = resolveGanttMinSpan(zoom, colW, viewportW);
    return computeVisibleRange(bars, today, padDays, minSpanDays);
  }, [bars, today, zoom, colW, viewportW]);

  const rangeStart = useMemo(
    () => addDaysIso(baseRange.start, rangeOffset),
    [baseRange.start, rangeOffset],
  );
  const rangeEnd = useMemo(
    () => addDaysIso(baseRange.end, rangeOffset),
    [baseRange.end, rangeOffset],
  );

  const days = useMemo(() => buildDays(rangeStart, rangeEnd, today), [rangeStart, rangeEnd, today]);
  const weeks = useMemo(() => buildWeekGroups(days), [days]);
  const lanes = Math.max(MIN_LANES, laneCount(bars));

  const gridWidth = days.length * colW;
  colWRef.current = colW;

  // Stretch the body so day columns + lane guides fill the chart viewport (no white half below).
  // viewportH is clientHeight, which already excludes scrollbars when present.
  const bodyHeight = useMemo(() => {
    const fromLanes = lanes * LANE_HEIGHT + 24;
    if (viewportH <= 0) return fromLanes;
    const available = viewportH - HEADER_WEEK_H - HEADER_DAY_H;
    return Math.max(fromLanes, Math.max(0, available));
  }, [lanes, viewportH]);

  /** How many lane rows to draw so guides cover the full stretched body. */
  const visualLanes = Math.max(lanes, Math.floor(Math.max(0, bodyHeight - 8) / LANE_HEIGHT));

  // Measure scroll viewport so columns fill width and the grid body fills height.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => {
      setViewportW(el.clientWidth);
      setViewportH(el.clientHeight);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [tareas.length]);

  /** Apply free zoom centered on the cursor (or chart center). Stable callback via colWRef. */
  const applyFreeZoom = useCallback((nextColW: number, clientX?: number) => {
    const el = scrollRef.current;
    const current = colWRef.current;
    const clamped = clampGanttColW(nextColW);
    if (clamped === current) return;

    if (el) {
      const rect = el.getBoundingClientRect();
      const x = clientX != null ? clientX - rect.left : rect.width / 2;
      const dayAtMouse = (el.scrollLeft + x) / Math.max(1, current);
      zoomAnchorRef.current = {
        dayAtMouse,
        viewRatio: rect.width > 0 ? x / rect.width : 0.5,
      };
    }

    setColWManual(clamped);
    setZoom(zoomLevelFromColW(clamped));
  }, []);

  // After free zoom, keep the day under the cursor fixed.
  useEffect(() => {
    const anchor = zoomAnchorRef.current;
    const el = scrollRef.current;
    if (!anchor || !el) return;
    zoomAnchorRef.current = null;
    const targetX = anchor.dayAtMouse * colW;
    const nextScroll = targetX - anchor.viewRatio * el.clientWidth;
    el.scrollLeft = Math.max(0, Math.min(nextScroll, el.scrollWidth - el.clientWidth));
  }, [colW]);

  // Ctrl/Meta + mouse wheel → free zoom (non-passive so we can block browser/Electron page zoom).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      e.stopPropagation();

      const raw = e.deltaY;
      // 0 = pixel, 1 = line, 2 = page
      const steps = e.deltaMode === 1 ? raw : e.deltaMode === 2 ? Math.sign(raw) * 3 : raw / 40;
      const magnitude = Math.max(COL_W_WHEEL_STEP, Math.min(14, Math.abs(steps) * COL_W_WHEEL_STEP));
      const delta = -Math.sign(steps || raw) * magnitude;
      applyFreeZoom(colWRef.current + delta, e.clientX);
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [applyFreeZoom, tareas.length]);

  const scheduledCount = tareas.filter((t) => t.start_date || t.due_date).length;
  const unscheduledCount = countUnscheduled(tareas, columns);
  const overdueCount = countOverdue(tareas, columns);

  const dayIndex = useCallback(
    (iso: string) => {
      const idx = diffDaysIso(rangeStart, iso);
      return idx;
    },
    [rangeStart],
  );

  const dateFromClientX = useCallback(
    (clientX: number) => {
      const el = scrollRef.current;
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      const x = clientX - rect.left + el.scrollLeft;
      const idx = Math.floor(x / colW);
      if (idx < 0 || idx >= days.length) return null;
      return days[idx]?.date ?? null;
    },
    [colW, days],
  );

  /**
   * Initial / "Hoy" horizontal scroll.
   * Prefer bringing task bars into view (otherwise a task on e.g. jul. 22 is
   * off-screen when the viewport is centered only on today).
   */
  const scrollChartIntoFocus = useCallback(
    (preferToday: boolean) => {
      const el = scrollRef.current;
      if (!el || days.length === 0 || colW <= 0) return;

      const todayIdx = days.findIndex((d) => d.isToday);
      const barIndexes = bars
        .map((b) => {
          const s = diffDaysIso(rangeStart, b.start);
          const e = diffDaysIso(rangeStart, b.end);
          return { s, e };
        })
        .filter((b) => b.e >= 0 && b.s < days.length);

      let scrollLeft = 0;

      if (!preferToday && barIndexes.length > 0) {
        const minStart = Math.max(0, Math.min(...barIndexes.map((b) => b.s)));
        const maxEnd = Math.min(days.length - 1, Math.max(...barIndexes.map((b) => b.e)));
        const spanPx = (maxEnd - minStart + 1) * colW;
        if (spanPx <= el.clientWidth * 0.85) {
          // All bars fit: pad a couple of days before the first bar
          scrollLeft = minStart * colW - Math.min(colW * 2, el.clientWidth * 0.15);
        } else {
          // Show from the first bar (overdue / earliest)
          scrollLeft = minStart * colW - colW;
        }
      } else if (todayIdx >= 0) {
        scrollLeft = todayIdx * colW - el.clientWidth / 3;
      } else {
        return;
      }

      el.scrollLeft = Math.max(0, Math.min(scrollLeft, el.scrollWidth - el.clientWidth));
    },
    [bars, colW, days, rangeStart],
  );

  // Scroll once when the chart is measured so tasks are not left off-screen.
  // Wait for viewportW > 0 (ResizeObserver) so colW/scrollWidth are final.
  useEffect(() => {
    if (didScrollToday.current) return;
    if (days.length === 0 || colW <= 0 || viewportW <= 0) return;
    const id = requestAnimationFrame(() => {
      scrollChartIntoFocus(false);
      didScrollToday.current = true;
    });
    return () => cancelAnimationFrame(id);
  }, [days, colW, viewportW, scrollChartIntoFocus]);

  const openCreateForDate = useCallback(
    (date: string) => {
      if (onAddTaskOnDate) {
        onAddTaskOnDate(date);
        return;
      }
      onAddTask?.();
    },
    [onAddTask, onAddTaskOnDate],
  );

  const handleGridClick = useCallback(
    (e: React.MouseEvent) => {
      if (dragRef.current?.moved) return;
      const target = e.target as HTMLElement;
      if (target.closest('[data-gantt-bar]')) return;
      if (target.closest('button')) return;
      const date = dateFromClientX(e.clientX);
      if (date) openCreateForDate(date);
    },
    [dateFromClientX, openCreateForDate],
  );

  const capturePointer = (target: HTMLElement, pointerId: number) => {
    if (typeof target.setPointerCapture === 'function') {
      try {
        target.setPointerCapture(pointerId);
      } catch {
        // jsdom / browsers without full pointer capture support
      }
    }
  };

  const beginDrag = useCallback((e: React.PointerEvent, bar: GanttBar, mode: GanttDragMode) => {
    e.stopPropagation();
    e.preventDefault();
    capturePointer(e.currentTarget as HTMLElement, e.pointerId);
    dragRef.current = {
      id: bar.tarea.id,
      mode,
      startX: e.clientX,
      originStart: bar.start,
      originEnd: bar.end,
      moved: false,
    };
    setDragPreview({
      id: bar.tarea.id,
      mode,
      start: bar.start,
      end: bar.end,
    });
  }, []);

  const handleBarPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const deltaDays = Math.round((e.clientX - drag.startX) / colW);
      if (deltaDays !== 0) drag.moved = true;
      const next = applyGanttDragDelta(drag.mode, drag.originStart, drag.originEnd, deltaDays);
      setDragPreview({
        id: drag.id,
        mode: drag.mode,
        start: next.start,
        end: next.end,
      });
    },
    [colW],
  );

  const handleBarPointerUp = useCallback(
    (e: React.PointerEvent, bar: GanttBar) => {
      const drag = dragRef.current;
      dragRef.current = null;
      setDragPreview(null);

      if (!drag || drag.id !== bar.tarea.id) return;

      if (!drag.moved) {
        // Resize handles never open edit on plain click
        if (drag.mode === 'move') onEditTask?.(bar.tarea);
        return;
      }

      const deltaDays = Math.round((e.clientX - drag.startX) / colW);
      if (deltaDays === 0) return;

      const next = applyGanttDragDelta(drag.mode, drag.originStart, drag.originEnd, deltaDays);
      if (next.start === drag.originStart && next.end === drag.originEnd) return;
      onDatesChange(bar.tarea.id, next.start, next.end);
    },
    [colW, onDatesChange, onEditTask],
  );

  const clearDrag = useCallback(() => {
    dragRef.current = null;
    setDragPreview(null);
  }, []);

  const setZoomPreset = (level: ZoomLevel) => {
    setZoom(level);
    setColWManual(null);
    didScrollToday.current = false;
  };

  const zoomIn = () => {
    applyFreeZoom(colW + COL_W_WHEEL_STEP * 2);
  };
  const zoomOut = () => {
    applyFreeZoom(colW - COL_W_WHEEL_STEP * 2);
  };

  const goToday = () => {
    setRangeOffset(0);
    didScrollToday.current = true;
    // After range resets, scroll to today on next paint
    requestAnimationFrame(() => scrollChartIntoFocus(true));
  };

  if (tareas.length === 0) {
    return (
      <EmptyState
        icon={ChartGantt}
        title="Gantt vacío"
        description="Crea tareas y asígnales fechas. También puedes hacer clic en un día del cronograma para crearlas aquí."
        actionLabel={onAddTask ? 'Nueva tarea' : undefined}
        onAction={onAddTask}
      />
    );
  }

  return (
    <div className="espacios-gantt flex h-full min-h-0 flex-1 flex-col bg-[var(--bg-elevated)]">
      {/* Toolbar */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-[var(--border-subtle)] px-3 py-2">
        <div className="min-w-0 shrink-0">
          <ViewStatsBar
            scheduled={scheduledCount}
            unscheduled={unscheduledCount}
            overdue={overdueCount}
          />
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          <WithHoverTooltip label="Anterior" placement="bottom">
            <button
              type="button"
              onClick={() => setRangeOffset((o) => o - 14)}
              className="gantt-tool-btn"
              aria-label="Periodo anterior"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
          </WithHoverTooltip>
          <button type="button" onClick={goToday} className="gantt-tool-btn px-2.5 text-[11px] font-medium">
            Hoy
          </button>
          <WithHoverTooltip label="Siguiente" placement="bottom">
            <button
              type="button"
              onClick={() => setRangeOffset((o) => o + 14)}
              className="gantt-tool-btn"
              aria-label="Periodo siguiente"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </WithHoverTooltip>

          <div className="mx-1 h-4 w-px bg-[var(--border-subtle)]" />

          <div
            className="flex overflow-hidden rounded-md border border-[var(--border-subtle)]"
            role="group"
            aria-label="Escala del Gantt"
          >
            {(
              [
                ['day', 'Día'],
                ['week', 'Semana'],
                ['month', 'Mes'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setZoomPreset(id)}
                aria-pressed={zoom === id && colWManual == null}
                data-gantt-zoom={id}
                data-col-w={zoom === id ? colW : undefined}
                className={`px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  zoom === id && colWManual == null
                    ? 'bg-[var(--text-primary)] text-[var(--bg-elevated)]'
                    : zoom === id
                      ? 'bg-[var(--text-primary)]/85 text-[var(--bg-elevated)]'
                      : 'bg-transparent text-[var(--text-muted)] hover:bg-[var(--bg-base)] hover:text-[var(--text-secondary)]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex overflow-hidden rounded-md border border-[var(--border-subtle)]">
            <WithHoverTooltip label="Acercar (Ctrl + rueda)" placement="bottom">
              <button
                type="button"
                onClick={zoomIn}
                disabled={colW >= COL_W_MAX}
                className="gantt-zoom-step border-r border-[var(--border-subtle)]"
                aria-label="Acercar"
              >
                <Plus className="h-3 w-3" strokeWidth={2.5} />
              </button>
            </WithHoverTooltip>
            <WithHoverTooltip label="Alejar (Ctrl + rueda)" placement="bottom">
              <button
                type="button"
                onClick={zoomOut}
                disabled={colW <= COL_W_MIN}
                className="gantt-zoom-step"
                aria-label="Alejar"
              >
                <Minus className="h-3 w-3" strokeWidth={2.5} />
              </button>
            </WithHoverTooltip>
          </div>
        </div>
      </div>

      {scheduledCount === 0 && (
        <div className="shrink-0 border-b border-dashed border-[var(--border-subtle)] px-4 py-2 text-center text-xs text-[var(--text-muted)]">
          Ninguna tarea tiene fecha. Haz clic en un día del cronograma o en «Nueva tarea» para crear.
        </div>
      )}

      {/* Chart */}
      <div ref={scrollRef} className="gantt-scroll relative min-h-0 flex-1 overflow-auto">
        <div
          className="relative"
          style={{ width: gridWidth, minHeight: HEADER_WEEK_H + HEADER_DAY_H + bodyHeight }}
        >
          {/* Sticky headers */}
          <div className="sticky top-0 z-20 bg-[var(--bg-elevated)]" style={{ width: gridWidth }}>
            {/* Week groups */}
            <div
              className="relative border-b border-[var(--border-subtle)]"
              style={{ height: HEADER_WEEK_H, width: gridWidth }}
            >
              {weeks.map((w) => (
                <div
                  key={`${w.key}-${w.startIndex}`}
                  className="absolute top-0 flex h-full items-center border-r border-[var(--border-subtle)] px-2"
                  style={{ left: w.startIndex * colW, width: w.span * colW }}
                >
                  <span className="truncate text-[10px] font-medium tracking-wide text-[var(--text-muted)]">
                    {w.label}
                  </span>
                </div>
              ))}
            </div>

            {/* Day headers */}
            <div
              className="relative border-b border-[var(--border-subtle)]"
              style={{ height: HEADER_DAY_H, width: gridWidth }}
            >
              {days.map((day, i) => {
                const { weekday, dayNum } = formatDayHeader(day);
                return (
                  <WithHoverTooltip
                    key={day.date}
                    label={`Crear tarea el ${day.date}`}
                    placement="bottom"
                    className="gantt-day-head absolute top-0 h-full"
                    style={{ left: i * colW, width: colW }}
                  >
                    <button
                      type="button"
                      className="flex h-full w-full flex-col items-center justify-center gap-0.5 border-r border-[var(--border-subtle)]/70 transition-colors hover:bg-[var(--bg-base)]"
                      style={{
                        background: day.isToday
                          ? 'color-mix(in srgb, var(--accent-red) 6%, transparent)'
                          : day.isWeekend
                            ? 'color-mix(in srgb, var(--text-muted) 5%, transparent)'
                            : undefined,
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        openCreateForDate(day.date);
                      }}
                      onMouseEnter={() => setHoverDate(day.date)}
                      onMouseLeave={() => setHoverDate((d) => (d === day.date ? null : d))}
                      aria-label={`Crear tarea el ${day.date}`}
                    >
                      <span
                        className={`text-[10px] leading-none ${
                          day.isToday ? 'font-semibold text-[var(--accent-red)]' : 'text-[var(--text-muted)]'
                        }`}
                      >
                        {weekday}
                      </span>
                      <span
                        className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] leading-none ${
                          day.isToday
                            ? 'bg-[var(--accent-red)] font-semibold text-[var(--text-on-accent)]'
                            : 'font-medium text-[var(--text-secondary)]'
                        }`}
                      >
                        {dayNum}
                      </span>
                      {hoverDate === day.date && !day.isToday && (onAddTask || onAddTaskOnDate) && (
                        <span className="pointer-events-none absolute right-0.5 top-0.5 text-[var(--text-muted)]">
                          <Plus className="h-2.5 w-2.5" strokeWidth={2.5} />
                        </span>
                      )}
                    </button>
                  </WithHoverTooltip>
                );
              })}
            </div>
          </div>

          {/* Body grid */}
          <div
            className="relative cursor-cell"
            style={{ width: gridWidth, height: bodyHeight }}
            onClick={handleGridClick}
            onMouseMove={(e) => {
              const d = dateFromClientX(e.clientX);
              setHoverDate(d);
            }}
            onMouseLeave={() => setHoverDate(null)}
            role="presentation"
          >
            {/* Day columns + weekend tint (equal width boxes) */}
            {days.map((day, i) => {
              let background = 'transparent';
              if (day.isToday) {
                background = 'color-mix(in srgb, var(--accent-red) 6%, transparent)';
              } else if (day.isWeekend) {
                background =
                  'color-mix(in srgb, var(--text-muted) 5%, transparent)';
              } else if (hoverDate === day.date) {
                background = 'color-mix(in srgb, var(--accent-primary) 5%, transparent)';
              }
              return (
                <div
                  key={day.date}
                  className="absolute top-0 box-border h-full border-r border-[var(--border-subtle)]/50"
                  style={{
                    left: i * colW,
                    width: colW,
                    background,
                  }}
                />
              );
            })}

            {/* Subtle lane guides across the full stretched body */}
            {Array.from({ length: visualLanes }, (_, lane) => (
              <div
                key={`lane-${lane}`}
                className="pointer-events-none absolute left-0 border-b border-[var(--border-subtle)]/40"
                style={{ top: (lane + 1) * LANE_HEIGHT + 4, width: gridWidth }}
                aria-hidden
              />
            ))}

            {/* Today vertical line + header connector */}
            {(() => {
              const idx = days.findIndex((d) => d.isToday);
              if (idx < 0) return null;
              return (
                <div
                  className="pointer-events-none absolute top-0 z-10 w-px bg-[var(--accent-red)]/80"
                  style={{ left: idx * colW + colW / 2, height: '100%' }}
                  aria-hidden
                >
                  <span
                    className="absolute left-1/2 top-0 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-[var(--accent-red)]"
                    style={{ marginTop: -3 }}
                  />
                </div>
              );
            })()}

            {/* Task bars — Fragment (not display:contents) so absolute coords stay in the body */}
            {bars.map((bar) => {
              const preview = dragPreview?.id === bar.tarea.id ? dragPreview : null;
              const start = preview?.start ?? bar.start;
              const end = preview?.end ?? bar.end;
              const startIdx = dayIndex(start);
              const endIdx = dayIndex(end);
              // Clip to visible window
              if (endIdx < 0 || startIdx >= days.length) return null;
              const leftIdx = Math.max(0, startIdx);
              const rightIdx = Math.min(days.length - 1, endIdx);
              const spanDays = rightIdx - leftIdx + 1;
              const durationDays = diffDaysIso(start, end) + 1;
              const isSingleDay = durationDays <= 1;
              // Marker only — never grows to fit a title. Single-day = compact chip; multi-day = range strip.
              const width = isSingleDay
                ? 28
                : Math.max(colW - 8, spanDays * colW - 8);
              const left = isSingleDay
                ? leftIdx * colW + (colW - width) / 2
                : leftIdx * colW + 4;
              const top = bar.lane * LANE_HEIGHT + (LANE_HEIGHT - BAR_HEIGHT) / 2 + 4;
              const accent = barAccent(bar, columns);
              const surface = barSurface(accent);
              const isActive = Boolean(preview);
              const isHovered = hoveredBarId === bar.tarea.id || isActive;
              const showHandles = isHovered || isActive;
              // Title lives only in the external label (never a child of the bar).
              const labelGap = 12;
              const labelMaxW = Math.max(160, colW * 4);
              const spaceRight = gridWidth - (left + width + labelGap);
              const labelOnLeft = spaceRight < 96;
              const labelLeft = labelOnLeft
                ? Math.max(0, left - labelGap - labelMaxW)
                : left + width + labelGap;
              const labelWidth = labelOnLeft
                ? Math.min(labelMaxW, Math.max(48, left - labelGap))
                : Math.min(labelMaxW, Math.max(80, spaceRight));
              const labelText = isActive
                ? `${bar.tarea.title} · ${formatRangeDuration(start, end)}`
                : bar.tarea.title;

              return (
                <Fragment key={bar.tarea.id}>
                  <div
                    data-gantt-bar
                    role="button"
                    tabIndex={0}
                    aria-label={`${bar.tarea.title}, ${formatRangeDuration(start, end)}`}
                    className={`gantt-bar absolute z-[5] flex cursor-grab items-center overflow-hidden border active:cursor-grabbing ${
                      isSingleDay ? 'justify-center rounded-full' : 'justify-start rounded-full px-2'
                    }`}
                    style={{
                      left,
                      top,
                      width,
                      height: BAR_HEIGHT,
                      background: surface,
                      borderColor: `color-mix(in srgb, ${accent} 45%, transparent)`,
                      color: accent,
                      boxShadow: isActive
                        ? `0 0 0 2px color-mix(in srgb, ${accent} 35%, transparent)`
                        : isHovered
                          ? `0 1px 4px color-mix(in srgb, ${accent} 22%, transparent)`
                          : undefined,
                    }}
                    onPointerDown={(e) => beginDrag(e, bar, 'move')}
                    onPointerMove={handleBarPointerMove}
                    onPointerUp={(e) => handleBarPointerUp(e, bar)}
                    onPointerCancel={clearDrag}
                    onMouseEnter={() => setHoveredBarId(bar.tarea.id)}
                    onMouseLeave={() => setHoveredBarId((id) => (id === bar.tarea.id ? null : id))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onEditTask?.(bar.tarea);
                      }
                    }}
                  >
                    {/* Left resize handle — no native title tooltip (avoids floating text over the card) */}
                    <span
                      className="gantt-handle gantt-handle-start"
                      data-gantt-handle="start"
                      aria-label={`Redimensionar inicio de ${bar.tarea.title}`}
                      style={{
                        opacity: showHandles ? 1 : 0,
                        borderColor: accent,
                      }}
                      onPointerDown={(e) => beginDrag(e, bar, 'resize-start')}
                      onPointerMove={handleBarPointerMove}
                      onPointerUp={(e) => handleBarPointerUp(e, bar)}
                      onPointerCancel={clearDrag}
                    />

                    <StatusDot
                      status={bar.tarea.status}
                      color={accent}
                      isDone={columnIsDone(columns, bar.tarea.status)}
                    />

                    {/* Right resize handle */}
                    <span
                      className="gantt-handle gantt-handle-end"
                      data-gantt-handle="end"
                      aria-label={`Redimensionar fin de ${bar.tarea.title}`}
                      style={{
                        opacity: showHandles ? 1 : 0,
                        borderColor: accent,
                      }}
                      onPointerDown={(e) => beginDrag(e, bar, 'resize-end')}
                      onPointerMove={handleBarPointerMove}
                      onPointerUp={(e) => handleBarPointerUp(e, bar)}
                      onPointerCancel={clearDrag}
                    />
                  </div>

                  {/* Title + drag range — always outside, never overlaid on the bar */}
                  <span
                    className="gantt-bar-label pointer-events-none absolute z-[6] truncate text-[10px] font-medium"
                    style={{
                      left: labelLeft,
                      top,
                      width: labelWidth,
                      height: BAR_HEIGHT,
                      lineHeight: `${BAR_HEIGHT}px`,
                      color: bar.overdue ? OVERDUE_COLOR : 'var(--text-secondary)',
                      textAlign: labelOnLeft ? 'right' : 'left',
                    }}
                  >
                    {labelText}
                  </span>
                </Fragment>
              );
            })}

            {/* Empty-lane create hint on hover */}
            {hoverDate && (onAddTask || onAddTaskOnDate) && (
              <div
                className="pointer-events-none absolute bottom-2 z-[1] flex items-center justify-center text-[10px] text-[var(--text-muted)]"
                style={{
                  left: Math.max(0, dayIndex(hoverDate)) * colW,
                  width: colW,
                }}
              >
                <span className="rounded bg-[var(--bg-elevated)]/90 px-1 py-0.5 opacity-70">+</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-t border-[var(--border-subtle)] px-3 py-2">
        {pickerColumns(columns).map((col) => (
          <span key={col.key} className="inline-flex items-center gap-1.5 text-[10px] text-[var(--text-muted)]">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ background: col.color }}
            />
            {col.name}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5 text-[10px] text-[var(--text-muted)]">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: OVERDUE_COLOR }} />
          Atrasada
        </span>
        <span className="ml-auto text-[10px] text-[var(--text-muted)]">
          Ctrl+rueda = zoom · Clic día = nueva · Arrastra = mover · Bordes = duración · Clic barra = editar
        </span>
      </div>

      <style>{`
        .espacios-gantt .gantt-scroll {
          scrollbar-width: thin;
          scrollbar-color: var(--scrollbar-thumb) transparent;
        }

        .espacios-gantt .gantt-scroll::-webkit-scrollbar {
          height: 10px;
          width: 10px;
        }

        .espacios-gantt .gantt-scroll::-webkit-scrollbar-thumb {
          background: var(--scrollbar-thumb);
          border: 3px solid transparent;
          background-clip: padding-box;
          border-radius: 10px;
        }

        .espacios-gantt .gantt-scroll::-webkit-scrollbar-thumb:hover {
          background: var(--scrollbar-thumb-hover);
          background-clip: padding-box;
        }

        .espacios-gantt .gantt-tool-btn {
          align-items: center;
          background: transparent;
          border: 1px solid var(--border-subtle);
          border-radius: 6px;
          color: var(--text-secondary);
          cursor: pointer;
          display: inline-flex;
          height: 1.75rem;
          justify-content: center;
          min-width: 1.75rem;
          transition: background 0.12s, color 0.12s, border-color 0.12s;
        }

        .espacios-gantt .gantt-tool-btn:hover {
          background: var(--bg-base);
          color: var(--text-primary);
        }

        .espacios-gantt .gantt-zoom-step {
          align-items: center;
          background: transparent;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          display: inline-flex;
          height: 1.75rem;
          justify-content: center;
          min-width: 1.5rem;
          padding: 0 0.4rem;
          transition: background 0.12s, color 0.12s;
        }

        .espacios-gantt .gantt-zoom-step:hover:not(:disabled) {
          background: var(--bg-base);
          color: var(--text-primary);
        }

        .espacios-gantt .gantt-zoom-step:disabled {
          cursor: default;
          opacity: 0.35;
        }

        .espacios-gantt .gantt-day-head {
          background: transparent;
          border-left: none;
          border-top: none;
          border-bottom: none;
          cursor: pointer;
          padding: 0;
        }

        .espacios-gantt .gantt-bar {
          /* Hard clip: no title, tooltip residue, or child text can paint on the card */
          font-size: 0;
          line-height: 0;
          overflow: hidden;
          touch-action: none;
          transition: box-shadow 0.12s, filter 0.12s;
          user-select: none;
        }

        .espacios-gantt .gantt-bar:hover {
          filter: brightness(1.04);
        }

        .espacios-gantt .gantt-bar:focus-visible {
          outline: 2px solid var(--accent-primary);
          outline-offset: 1px;
        }

        .espacios-gantt .gantt-bar-label {
          background: color-mix(in srgb, var(--bg-elevated) 92%, transparent);
          border-radius: 4px;
          padding: 0 4px;
        }

        .espacios-gantt .gantt-handle {
          background: var(--bg-elevated);
          border: 1.5px solid;
          border-radius: 999px;
          box-shadow: 0 1px 2px color-mix(in srgb, var(--bg-base) 35%, transparent);
          cursor: ew-resize;
          flex-shrink: 0;
          height: 12px;
          position: absolute;
          top: 50%;
          touch-action: none;
          transform: translateY(-50%);
          transition: opacity 0.12s, transform 0.12s, box-shadow 0.12s;
          width: 12px;
          z-index: 2;
        }

        .espacios-gantt .gantt-handle:hover {
          box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent-primary) 22%, transparent);
          transform: translateY(-50%) scale(1.08);
        }

        .espacios-gantt .gantt-handle-start {
          left: -1px;
        }

        .espacios-gantt .gantt-handle-end {
          right: -1px;
        }
      `}</style>
    </div>
  );
}
