import { toIsoDateLocal } from '../../../utils/dates';

export function toLocalDateString(date: Date): string {
  return toIsoDateLocal(date);
}

export function localTodayString(): string {
  return toLocalDateString(new Date());
}

export function addDaysToIsoDate(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  if (!year || !month || !day) return isoDate;
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + days);
  return toLocalDateString(date);
}

export function daysBetweenIsoDates(fromIso: string, toIso: string): number | null {
  const [fy, fm, fd] = fromIso.split('-').map(Number);
  const [ty, tm, td] = toIso.split('-').map(Number);
  if (!fy || !fm || !fd || !ty || !tm || !td) return null;
  const from = Date.UTC(fy, fm - 1, fd);
  const to = Date.UTC(ty, tm - 1, td);
  return Math.round((to - from) / 86_400_000);
}

const DISPLAY_FORMATTER = new Intl.DateTimeFormat('es', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

export function formatDisplayDate(isoDate: string | null): string {
  if (!isoDate) return '—';
  const [year, month, day] = isoDate.split('-').map(Number);
  if (!year || !month || !day) return isoDate;
  return DISPLAY_FORMATTER.format(new Date(year, month - 1, day));
}

export function formatRelativeDate(isoDate: string | null, today = localTodayString()): string {
  if (!isoDate) return '—';
  const [y, m, d] = isoDate.split('-').map(Number);
  const [ty, tm, td] = today.split('-').map(Number);
  if (!y || !m || !d || !ty || !tm || !td) return isoDate;

  const target = Date.UTC(y, m - 1, d);
  const base = Date.UTC(ty, tm - 1, td);
  const diffDays = Math.round((target - base) / 86_400_000);

  if (diffDays === 0) return 'Hoy';
  if (diffDays === -1) return 'Ayer';
  if (diffDays === 1) return 'Mañana';
  if (diffDays < -1) return `Hace ${Math.abs(diffDays)} días`;
  return `En ${diffDays} días`;
}