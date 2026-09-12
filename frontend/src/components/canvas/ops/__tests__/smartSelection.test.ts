import { describe, expect, it } from 'vitest';
import { createLayer } from '../../constants';
import { parseMm } from '../../types';
import {
  detectSmartSequence,
  resizeSmartGap,
  smartGapRect,
  tidySmartSequence,
} from '../smartSelection';

function rectAt(id: string, x: number, y: number, w = 10, h = 10) {
  return createLayer('rect', {
    id,
    cssVars: {
      ...createLayer('rect').cssVars,
      '--translate-x': `${x}mm`,
      '--translate-y': `${y}mm`,
      '--width': `${w}mm`,
      '--height': `${h}mm`,
    },
  });
}

const x = (l: ReturnType<typeof rectAt>) => parseMm(l.cssVars['--translate-x']);
const y = (l: ReturnType<typeof rectAt>) => parseMm(l.cssVars['--translate-y']);

describe('detectSmartSequence', () => {
  it('detects a horizontal row and sorts by x', () => {
    const a = rectAt('a', 40, 10);
    const b = rectAt('b', 10, 12);
    const c = rectAt('c', 25, 11);
    const seq = detectSmartSequence([a, b, c], ['a', 'b', 'c'])!;
    expect(seq.axis).toBe('x');
    expect(seq.ids).toEqual(['b', 'c', 'a']);
    expect(seq.gaps).toEqual([5, 5]);
    expect(seq.uniform).toBe(true);
  });

  it('detects a vertical column', () => {
    const a = rectAt('a', 10, 10);
    const b = rectAt('b', 12, 30);
    const c = rectAt('c', 11, 50);
    const seq = detectSmartSequence([a, b, c], ['a', 'b', 'c'])!;
    expect(seq.axis).toBe('y');
    expect(seq.ids).toEqual(['a', 'b', 'c']);
    expect(seq.gaps).toEqual([10, 10]);
  });

  it('reports non-uniform gaps', () => {
    const a = rectAt('a', 10, 10);
    const b = rectAt('b', 30, 10);
    const c = rectAt('c', 60, 10);
    const seq = detectSmartSequence([a, b, c], ['a', 'b', 'c'])!;
    expect(seq.uniform).toBe(false);
  });

  it('returns null when items are not aligned in a row or column', () => {
    const a = rectAt('a', 10, 10);
    const b = rectAt('b', 40, 40);
    const c = rectAt('c', 70, 80);
    expect(detectSmartSequence([a, b, c], ['a', 'b', 'c'])).toBeNull();
  });

  it('skips locked, hidden and frame layers', () => {
    const a = rectAt('a', 10, 10);
    const b = { ...rectAt('b', 30, 10), locked: true };
    const c = rectAt('c', 50, 10);
    const seq = detectSmartSequence([a, b, c], ['a', 'b', 'c'])!;
    expect(seq.ids).toEqual(['a', 'c']);
  });

  it('returns null for a single layer', () => {
    const a = rectAt('a', 10, 10);
    expect(detectSmartSequence([a], ['a'])).toBeNull();
  });
});

describe('smartGapRect', () => {
  it('returns the gap rect between consecutive row items', () => {
    const a = rectAt('a', 10, 10);
    const b = rectAt('b', 30, 14, 10, 6);
    const seq = detectSmartSequence([a, b], ['a', 'b'])!;
    const rect = smartGapRect(seq, 0);
    expect(rect.x).toBe(20);
    expect(rect.w).toBe(10);
    expect(rect.y).toBe(14);
    expect(rect.h).toBe(6);
  });
});

describe('resizeSmartGap', () => {
  it('moves only the layers after the gap', () => {
    const a = rectAt('a', 10, 10);
    const b = rectAt('b', 30, 10);
    const c = rectAt('c', 50, 10);
    const seq = detectSmartSequence([a, b, c], ['a', 'b', 'c'])!;

    const next = resizeSmartGap([a, b, c], seq, 0, 15);
    const na = next.find((l) => l.id === 'a')!;
    const nb = next.find((l) => l.id === 'b')!;
    const nc = next.find((l) => l.id === 'c')!;
    expect(x(na)).toBe(10);
    expect(x(nb)).toBe(35);
    expect(x(nc)).toBe(55);
  });

  it('moves descendants together with their parent', () => {
    const g = createLayer('group', {
      id: 'g',
      cssVars: {
        '--translate-x': '30mm',
        '--translate-y': '10mm',
        '--width': '10mm',
        '--height': '10mm',
      },
    });
    const child = { ...rectAt('ch', 32, 12, 4, 4), parentId: 'g' };
    const a = rectAt('a', 10, 10);
    const seq = detectSmartSequence([a, g, child], ['a', 'g'])!;

    const next = resizeSmartGap([a, g, child], seq, 0, 15);
    const ng = next.find((l) => l.id === 'g')!;
    const nch = next.find((l) => l.id === 'ch')!;
    expect(x(ng)).toBe(35);
    expect(x(nch)).toBe(37);
  });
});

describe('tidySmartSequence', () => {
  it('equalizes gaps while preserving the outer span', () => {
    const a = rectAt('a', 10, 10);
    const b = rectAt('b', 25, 10);
    const c = rectAt('c', 60, 10);
    const layers = [a, b, c];
    const seq = detectSmartSequence(layers, ['a', 'b', 'c'])!;

    const next = tidySmartSequence(layers, seq);
    const na = next.find((l) => l.id === 'a')!;
    const nb = next.find((l) => l.id === 'b')!;
    const nc = next.find((l) => l.id === 'c')!;
    expect(x(na)).toBe(10);
    expect(x(nc)).toBe(60);
    // span 10..70, sizes 10*3 → gap = (60 - 30) / 2 = 15 → b at 35
    expect(x(nb)).toBe(35);
  });

  it('is a no-op for two layers', () => {
    const a = rectAt('a', 10, 10);
    const b = rectAt('b', 30, 10);
    const seq = detectSmartSequence([a, b], ['a', 'b'])!;
    expect(tidySmartSequence([a, b], seq)).toEqual([a, b]);
  });
});
