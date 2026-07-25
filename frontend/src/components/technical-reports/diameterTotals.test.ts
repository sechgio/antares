import { describe, expect, it } from 'vitest';
import { sumDiameterColumns, sumDiameterRow } from './diameterTotals';

describe('sumDiameterColumns', () => {
  it('sums diameter columns across rows', () => {
    const rows = [
      { '6"': 2, '8"': 1 },
      { '6"': 3, '8"': 0 },
    ];
    const totals = sumDiameterColumns(rows, ['6"', '8"']);
    expect(totals['6"']).toBe(5);
    expect(totals['8"']).toBe(1);
  });

  it('returns 0 for empty rows', () => {
    const totals = sumDiameterColumns([], ['6"']);
    expect(totals['6"']).toBe(0);
  });
});

describe('sumDiameterRow', () => {
  it('sums all diameter values in a single row', () => {
    const row = { '2': 1, '4': 3, '6': 0, '8': 2 };
    expect(sumDiameterRow(row, ['2', '4', '6', '8'])).toBe(6);
  });

  it('returns 0 for an empty row', () => {
    expect(sumDiameterRow({}, ['2', '4'])).toBe(0);
  });

  it('ignores diameters not present in the row', () => {
    const row = { '4': 5 };
    expect(sumDiameterRow(row, ['2', '4', '6'])).toBe(5);
  });
});

describe('row totals == column totals (cross-check)', () => {
  it('grand total is consistent in both dimensions', () => {
    const diameters = ['2', '4', '6'];
    const rows = [
      { '2': 1, '4': 0, '6': 2 },
      { '2': 0, '4': 3, '6': 0 },
      { '2': 1, '4': 1, '6': 1 },
    ];

    const colTotals = sumDiameterColumns(rows, diameters);
    const grandTotalFromCols = Object.values(colTotals).reduce((a, b) => a + b, 0);

    const grandTotalFromRows = rows.reduce((acc, row) => acc + sumDiameterRow(row, diameters), 0);

    expect(grandTotalFromRows).toBe(grandTotalFromCols);
    expect(grandTotalFromRows).toBe(9);
  });
});
