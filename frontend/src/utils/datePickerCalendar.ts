import { parseIsoDateLocal } from './dates';

export interface CalendarCell {
  date: Date | null;
  outside: boolean;
}

export function buildMonthCalendar(month: Date, fillAdjacentDates: boolean): CalendarCell[] {
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const leadingCount = new Date(year, monthIndex, 1).getDay();
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const cells: CalendarCell[] = [];

  if (fillAdjacentDates) {
    const previousMonthDays = new Date(year, monthIndex, 0).getDate();
    for (let index = leadingCount - 1; index >= 0; index -= 1) {
      cells.push({
        date: new Date(year, monthIndex - 1, previousMonthDays - index),
        outside: true,
      });
    }
  } else {
    for (let index = 0; index < leadingCount; index += 1) {
      cells.push({ date: null, outside: true });
    }
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push({ date: new Date(year, monthIndex, day), outside: false });
  }

  if (fillAdjacentDates) {
    while (cells.length % 7 !== 0) {
      const nextDay = cells.length - leadingCount - daysInMonth + 1;
      cells.push({ date: new Date(year, monthIndex + 1, nextDay), outside: true });
    }
  }

  return cells;
}

export function formatDate(date: Date | null, placeholder: string): string {
  if (!date) return placeholder;
  return date.toLocaleDateString('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

export function formatIsoDate(value: string, placeholder: string): string {
  return formatDate(parseIsoDateLocal(value), placeholder);
}
