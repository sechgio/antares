import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_LINE_STROKE_PX } from '../ops/layerStyle';
import {
  rememberStrokeWeight,
  resetLastStrokeWeight,
  strokeWeightForNewLine,
} from '../ops/strokeWeightStore';

describe('strokeWeightStore', () => {
  beforeEach(() => {
    resetLastStrokeWeight();
  });

  it('returns the default weight initially', () => {
    expect(strokeWeightForNewLine()).toBe(DEFAULT_LINE_STROKE_PX);
  });

  it('remembers a positive weight for the next line insert', () => {
    rememberStrokeWeight(4.5);
    expect(strokeWeightForNewLine()).toBe(4.5);
  });

  it('ignores zero and negative weights (keeps the previous value)', () => {
    rememberStrokeWeight(3);
    rememberStrokeWeight(0);
    expect(strokeWeightForNewLine()).toBe(3);
    rememberStrokeWeight(-1);
    expect(strokeWeightForNewLine()).toBe(3);
  });

  it('clamps weights to the allowed range', () => {
    rememberStrokeWeight(1000);
    // STROKE_WEIGHT_MAX_PX = 100
    expect(strokeWeightForNewLine()).toBe(100);
  });

  it('resetLastStrokeWeight() restores the default', () => {
    rememberStrokeWeight(8);
    resetLastStrokeWeight();
    expect(strokeWeightForNewLine()).toBe(DEFAULT_LINE_STROKE_PX);
  });

  it('resetLastStrokeWeight(px) sets an explicit value', () => {
    resetLastStrokeWeight(2);
    expect(strokeWeightForNewLine()).toBe(2);
  });

  it('resetLastStrokeWeight clamps an out-of-range argument', () => {
    resetLastStrokeWeight(1000);
    expect(strokeWeightForNewLine()).toBe(100);
    resetLastStrokeWeight(-5);
    // Negative clamps to 0, then `|| DEFAULT_LINE_STROKE_PX` kicks in.
    expect(strokeWeightForNewLine()).toBe(DEFAULT_LINE_STROKE_PX);
  });
});
