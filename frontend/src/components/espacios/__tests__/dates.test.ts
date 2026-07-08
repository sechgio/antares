import { describe, expect, it } from 'vitest';
import { formatDisplayDate, toLocalDateString } from '../utils/dates';

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

describe('formatDisplayDate', () => {
  it('formats ISO dates for display', () => {
    expect(formatDisplayDate('2026-03-15')).toMatch(/15/);
    expect(formatDisplayDate('2026-03-15')).toMatch(/mar/i);
  });

  it('returns dash for null', () => {
    expect(formatDisplayDate(null)).toBe('—');
  });
});