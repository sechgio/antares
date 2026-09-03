import { describe, expect, it } from 'vitest';
import { isSameDate, monthStart, parseIsoDateLocal, toIsoDateLocal } from './dates';

describe('utils/dates', () => {
  it('formats a local Date as YYYY-MM-DD without UTC drift', () => {
    expect(toIsoDateLocal(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(toIsoDateLocal(new Date(2026, 11, 31))).toBe('2026-12-31');
  });

  it('parses valid ISO local dates and rejects anything else', () => {
    const parsed = parseIsoDateLocal('2026-07-06');
    expect(parsed?.getFullYear()).toBe(2026);
    expect(parsed?.getMonth()).toBe(6);
    expect(parsed?.getDate()).toBe(6);
    expect(parseIsoDateLocal('')).toBeNull();
    expect(parseIsoDateLocal('06/07/2026')).toBeNull();
    expect(parseIsoDateLocal('2026-13-40')).toBeNull();
  });

  it('compares only day/month/year', () => {
    expect(isSameDate(new Date(2026, 6, 6, 23, 59), new Date(2026, 6, 6, 0, 0))).toBe(true);
    expect(isSameDate(new Date(2026, 6, 6), new Date(2026, 6, 7))).toBe(false);
  });

  it('returns the first day of the month at local midnight', () => {
    const start = monthStart(new Date(2026, 6, 21));
    expect(start.getFullYear()).toBe(2026);
    expect(start.getMonth()).toBe(6);
    expect(start.getDate()).toBe(1);
  });
});