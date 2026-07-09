import { describe, expect, it } from 'vitest';
import {
  addDaysToIsoDate,
  daysBetweenIsoDates,
  formatDisplayDate,
  formatRelativeDate,
  toLocalDateString,
} from '../utils/dates';

describe('toLocalDateString', () => {
  it('formats the local calendar day', () => {
    const date = new Date(2026, 2, 15, 23, 59, 0);
    expect(toLocalDateString(date)).toBe('2026-03-15');
  });

  it('avoids UTC day shift from toISOString near midnight', () => {
    const date = new Date(2026, 2, 15, 0, 30, 0);
    expect(toLocalDateString(date)).toBe('2026-03-15');
    if (date.toISOString().slice(0, 10) !== '2026-03-15') {
      expect(toLocalDateString(date)).not.toBe(date.toISOString().slice(0, 10));
    }
  });
});

describe('addDaysToIsoDate / daysBetweenIsoDates', () => {
  it('adds calendar days without UTC shift', () => {
    expect(addDaysToIsoDate('2026-07-08', 3)).toBe('2026-07-11');
    expect(addDaysToIsoDate('2026-07-30', 3)).toBe('2026-08-02');
  });

  it('computes signed day deltas', () => {
    expect(daysBetweenIsoDates('2026-07-08', '2026-07-05')).toBe(-3);
    expect(daysBetweenIsoDates('2026-07-08', '2026-07-08')).toBe(0);
    expect(daysBetweenIsoDates('2026-07-08', '2026-07-11')).toBe(3);
  });
});

describe('formatDisplayDate', () => {
  it('formats ISO dates for display', () => {
    expect(formatDisplayDate('2026-03-15')).toMatch(/15/);
    expect(formatDisplayDate('2026-03-15')).toMatch(/mar/i);
  });

  it('returns dash for null', () => {
    expect(formatDisplayDate(null)).toBe('—');
  });
});

describe('formatRelativeDate', () => {
  const today = '2026-03-15';

  it('returns relative Spanish labels', () => {
    expect(formatRelativeDate('2026-03-15', today)).toBe('Hoy');
    expect(formatRelativeDate('2026-03-14', today)).toBe('Ayer');
    expect(formatRelativeDate('2026-03-16', today)).toBe('Mañana');
    expect(formatRelativeDate('2026-03-12', today)).toBe('Hace 3 días');
    expect(formatRelativeDate('2026-03-18', today)).toBe('En 3 días');
  });

  it('returns dash for null', () => {
    expect(formatRelativeDate(null, today)).toBe('—');
  });
});