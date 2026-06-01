import { describe, expect, it } from 'vitest';
import { sumDiameterColumns } from './diameterTotals';

describe('sumDiameterColumns', () => {
  it('adds values vertically for each diameter', () => {
    const totals = sumDiameterColumns(
      [{ '8': 1, '10': 1 }, { '10': 1 }, { '12': 1, '10': 1 }],
      ['2', '3', '4', '6', '8', '10', '12'],
    );

    expect(totals['8']).toBe(1);
    expect(totals['10']).toBe(3);
    expect(totals['12']).toBe(1);
    expect(totals['2']).toBe(0);
  });
});
