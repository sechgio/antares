import { describe, expect, it } from 'vitest';
import { mapWithConcurrencyLimit } from './mapWithConcurrencyLimit';

describe('mapWithConcurrencyLimit', () => {
  it('preserves order while bounding active tasks', async () => {
    let active = 0;
    let peak = 0;
    const result = await mapWithConcurrencyLimit([1, 2, 3, 4, 5], 2, async (value) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, value === 1 ? 15 : 0));
      active -= 1;
      return value * 10;
    });

    expect(result).toEqual([10, 20, 30, 40, 50]);
    expect(peak).toBeLessThanOrEqual(2);
  });

  it('returns an empty array without invoking the mapper', async () => {
    let calls = 0;
    const result = await mapWithConcurrencyLimit([], 2, async (value: number) => {
      calls += 1;
      return value;
    });

    expect(result).toEqual([]);
    expect(calls).toBe(0);
  });
});
