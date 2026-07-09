import type { BoardColumn, Tarea } from '../types';
import { localTodayString, toLocalDateString } from './dates';
import { columnIsDone } from './statusConfig';

export interface GanttBar {
  tarea: Tarea;
  start: string;
  end: string;
  /** Inclusive day span (at least 1). */
  durationDays: number;
  lane: number;
  overdue: boolean;
}

export interface GanttDay {
  date: string;
  weekday: number;
  isWeekend: boolean;
  isToday: boolean;
}

/** Parse YYYY-MM-DD as local midnight. */
export function parseLocalDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export function addDaysIso(iso: string, days: number): string {
  const date = parseLocalDate(iso);
  date.setDate(date.getDate() + days);
  return toLocalDateString(date);
}

export function diffDaysIso(from: string, to: string): number {
  const a = parseLocalDate(from).getTime();
  const b = parseLocalDate(to).getTime();
  return Math.round((b - a) / 86_400_000);
}

/**
 * Resolve the inclusive [start, end] range for a task on the Gantt.
 * Falls back to due_date or created_at so every task can be drawn.
 */
export function resolveTaskRange(tarea: Tarea): { start: string; end: string } {
  const created = tarea.created_at.slice(0, 10);
  const start = tarea.start_date ?? tarea.due_date ?? created;
  let end = tarea.due_date ?? tarea.start_date ?? created;
  if (end < start) end = start;
  return { start, end };
}

export function isTaskOverdue(
  tarea: Tarea,
  today = localTodayString(),
  columns: BoardColumn[] = [],
): boolean {
  if (!tarea.due_date || tarea.due_date >= today) return false;
  if (columns.length > 0) return !columnIsDone(columns, tarea.status);
  // Fallback when columns are not loaded yet (builtin done-like keys).
  return tarea.status !== 'done' && tarea.status !== 'closed';
}

/**
 * Pack intervals into non-overlapping horizontal lanes (first-fit).
 * Tasks that share dates never share a lane, so bars never stack on top of each other.
 */
export function packLanes(
  items: Array<{ id: string; start: string; end: string }>,
): Map<string, number> {
  const sorted = [...items].sort((a, b) => {
    if (a.start !== b.start) return a.start < b.start ? -1 : 1;
    if (a.end !== b.end) return a.end < b.end ? -1 : 1;
    return a.id.localeCompare(b.id);
  });

  /** laneEnds[i] = last end date currently placed in lane i */
  const laneEnds: string[] = [];
  const lanes = new Map<string, number>();

  for (const item of sorted) {
    let placed = -1;
    for (let i = 0; i < laneEnds.length; i += 1) {
      // Non-overlap: next start must be strictly after previous end
      if (item.start > laneEnds[i]) {
        placed = i;
        break;
      }
    }
    if (placed === -1) {
      placed = laneEnds.length;
      laneEnds.push(item.end);
    } else {
      laneEnds[placed] = item.end;
    }
    lanes.set(item.id, placed);
  }

  return lanes;
}

export function buildGanttBars(
  tareas: Tarea[],
  today = localTodayString(),
  columns: BoardColumn[] = [],
): GanttBar[] {
  const ranges = tareas.map((tarea) => {
    const { start, end } = resolveTaskRange(tarea);
    return {
      tarea,
      start,
      end,
      durationDays: diffDaysIso(start, end) + 1,
      overdue: isTaskOverdue(tarea, today, columns),
      lane: 0,
    };
  });

  const laneMap = packLanes(ranges.map((r) => ({ id: r.tarea.id, start: r.start, end: r.end })));

  return ranges
    .map((r) => ({ ...r, lane: laneMap.get(r.tarea.id) ?? 0 }))
    .sort((a, b) => a.lane - b.lane || (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
}

export function laneCount(bars: GanttBar[]): number {
  if (bars.length === 0) return 0;
  return Math.max(...bars.map((b) => b.lane)) + 1;
}

/** Visible day window padded around tasks (and always including today). */
export function computeVisibleRange(
  bars: GanttBar[],
  today = localTodayString(),
  padDays = 7,
  minSpanDays = 21,
): { start: string; end: string } {
  let min = today;
  let max = today;

  for (const bar of bars) {
    if (bar.start < min) min = bar.start;
    if (bar.end > max) max = bar.end;
  }

  let start = addDaysIso(min, -padDays);
  let end = addDaysIso(max, padDays);

  const span = diffDaysIso(start, end) + 1;
  if (span < minSpanDays) {
    const extra = minSpanDays - span;
    const left = Math.floor(extra / 2);
    const right = extra - left;
    start = addDaysIso(start, -left);
    end = addDaysIso(end, right);
  }

  return { start, end };
}

export function buildDays(rangeStart: string, rangeEnd: string, today = localTodayString()): GanttDay[] {
  const days: GanttDay[] = [];
  let cursor = rangeStart;
  while (cursor <= rangeEnd) {
    const date = parseLocalDate(cursor);
    const weekday = date.getDay();
    days.push({
      date: cursor,
      weekday,
      isWeekend: weekday === 0 || weekday === 6,
      isToday: cursor === today,
    });
    cursor = addDaysIso(cursor, 1);
  }
  return days;
}

export interface GanttWeekGroup {
  key: string;
  label: string;
  startIndex: number;
  span: number;
}

/** ISO-like week label: W27 · 5–11 jul. */
export function buildWeekGroups(days: GanttDay[]): GanttWeekGroup[] {
  if (days.length === 0) return [];

  const groups: GanttWeekGroup[] = [];
  let groupStart = 0;

  const weekKey = (iso: string) => {
    const d = parseLocalDate(iso);
    // ISO week: Thursday-based week number
    const tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const dayNum = tmp.getUTCDay() || 7;
    tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil(((tmp.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
    return `${tmp.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
  };

  const formatRange = (from: string, to: string) => {
    const a = parseLocalDate(from);
    const b = parseLocalDate(to);
    const weekNo = weekKey(from).split('-W')[1];
    const monthFmt = new Intl.DateTimeFormat('es', { month: 'short' });
    const ma = monthFmt.format(a).replace('.', '');
    const mb = monthFmt.format(b).replace('.', '');
    if (a.getMonth() === b.getMonth()) {
      return `W${weekNo} · ${a.getDate()}–${b.getDate()} ${ma}.`;
    }
    return `W${weekNo} · ${a.getDate()} ${ma}. – ${b.getDate()} ${mb}.`;
  };

  for (let i = 1; i <= days.length; i += 1) {
    const prev = days[i - 1];
    const curr = days[i];
    const boundary = !curr || weekKey(curr.date) !== weekKey(prev.date);
    if (boundary) {
      const start = days[groupStart].date;
      const end = days[i - 1].date;
      groups.push({
        key: weekKey(start),
        label: formatRange(start, end),
        startIndex: groupStart,
        span: i - groupStart,
      });
      groupStart = i;
    }
  }

  return groups;
}

const WEEKDAY_SHORT = ['do', 'lu', 'ma', 'mi', 'ju', 'vi', 'sá'];

export function formatDayHeader(day: GanttDay): { weekday: string; dayNum: number } {
  return {
    weekday: WEEKDAY_SHORT[day.weekday] ?? '',
    dayNum: parseLocalDate(day.date).getDate(),
  };
}

export type GanttDragMode = 'move' | 'resize-start' | 'resize-end';

export type GanttZoomLevel = 'day' | 'week' | 'month';

/** Preset day-column widths for Día / Semana / Mes. */
export const GANTT_ZOOM_PRESET_COL: Record<GanttZoomLevel, number> = {
  day: 72,
  week: 44,
  month: 26,
};

/** Padding (days) around the task window per zoom preset. */
export const GANTT_ZOOM_PAD_DAYS: Record<GanttZoomLevel, number> = {
  day: 7,
  week: 14,
  month: 30,
};

/** Minimum visible day span per zoom preset. */
export const GANTT_ZOOM_MIN_SPAN: Record<GanttZoomLevel, number> = {
  day: 21,
  week: 56,
  month: 120,
};

export const GANTT_COL_W_MIN = 16;
export const GANTT_COL_W_MAX = 160;

export function clampGanttColW(w: number): number {
  return Math.min(GANTT_COL_W_MAX, Math.max(GANTT_COL_W_MIN, Math.round(w)));
}

/**
 * Resolve column width for a zoom mode.
 * Presets must stay distinct — never inflate to fill the viewport (that made
 * Día / Semana / Mes look identical on wide screens or short ranges).
 */
export function resolveGanttColW(zoom: GanttZoomLevel, colWManual: number | null): number {
  return clampGanttColW(colWManual ?? GANTT_ZOOM_PRESET_COL[zoom]);
}

export function zoomLevelFromColW(w: number): GanttZoomLevel {
  if (w >= 58) return 'day';
  if (w >= 34) return 'week';
  return 'month';
}

/**
 * Minimum day span so the chart can fill the viewport at the current column width
 * without stretching columns (which would erase zoom differences).
 */
export function resolveGanttMinSpan(
  zoom: GanttZoomLevel,
  colW: number,
  viewportW: number,
): { padDays: number; minSpanDays: number } {
  const padDays = GANTT_ZOOM_PAD_DAYS[zoom];
  const presetMin = GANTT_ZOOM_MIN_SPAN[zoom];
  if (viewportW <= 0 || colW <= 0) {
    return { padDays, minSpanDays: presetMin };
  }
  // +2 so there is a little overflow (scrollbar cue) rather than a flush edge
  const fillSpan = Math.ceil(viewportW / colW) + 2;
  return { padDays, minSpanDays: Math.max(presetMin, fillSpan) };
}

/**
 * Apply a day delta from a Gantt drag/resize gesture.
 * Resize never collapses below 1 day (start cannot pass end).
 */
export function applyGanttDragDelta(
  mode: GanttDragMode,
  originStart: string,
  originEnd: string,
  deltaDays: number,
): { start: string; end: string } {
  if (mode === 'move') {
    return {
      start: addDaysIso(originStart, deltaDays),
      end: addDaysIso(originEnd, deltaDays),
    };
  }
  if (mode === 'resize-start') {
    let start = addDaysIso(originStart, deltaDays);
    if (start > originEnd) start = originEnd;
    return { start, end: originEnd };
  }
  let end = addDaysIso(originEnd, deltaDays);
  if (end < originStart) end = originStart;
  return { start: originStart, end };
}
