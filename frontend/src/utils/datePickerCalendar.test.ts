import { describe, expect, it } from 'vitest';
import { buildMonthCalendar, formatDate, formatIsoDate } from './datePickerCalendar';

describe('buildMonthCalendar', () => {
  const september = new Date(2026, 8, 1);

  it('keeps leading empty cells and omits trailing cells for compact calendars', () => {
    const cells = buildMonthCalendar(september, false);

    expect(cells.slice(0, 2)).toEqual([
      { date: null, outside: true },
      { date: null, outside: true },
    ]);
    expect(cells.at(2)?.date?.getDate()).toBe(1);
    expect(cells.at(-1)?.date?.getDate()).toBe(30);
    expect(cells).toHaveLength(32);
  });

  it('fills adjacent dates through the final calendar week', () => {
    const cells = buildMonthCalendar(september, true);

    expect(cells).toHaveLength(35);
    expect(cells[0]).toMatchObject({ outside: true });
    expect(cells[0].date?.getMonth()).toBe(7);
    expect(cells.at(-1)?.date?.getMonth()).toBe(9);
  });
});

describe('formatIsoDate', () => {
  it('formats valid local ISO dates and preserves the caller placeholder', () => {
    expect(formatIsoDate('2026-09-02', 'Elegir')).toBe('02/09/2026');
    expect(formatIsoDate('', 'Elegir')).toBe('Elegir');
  });

  it('can preserve the compact picker display for malformed non-empty values', () => {
    const invalidDate = new Date('malformedT00:00:00');
    expect(formatDate(invalidDate, 'Elegir')).toBe(
      invalidDate.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' }),
    );
  });
});
