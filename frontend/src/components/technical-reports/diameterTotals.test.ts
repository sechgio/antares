import { describe, expect, it } from 'vitest';
import { sumDiameterColumns } from './diameterTotals';

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
