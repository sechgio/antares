import { describe, expect, it } from 'vitest';
import { createLayer } from '../constants';
import {
  applyCornerRadiusDrag,
  clampCornerRadiusPx,
  computeRadiusFromDrag,
  layerSupportsCornerRadius,
  layersWithCornerRadius,
  maxCornerRadiusPx,
  projectRadiusDelta,
  radiusHandleInsetPx,
} from '../ops/cornerRadiusGesture';
import { MM_TO_PX } from '../ops/drawHelpers';
import { cornerRadiusPx } from '../ops/layerStyle';

describe('cornerRadiusGesture', () => {
  it('clamps max radius to half the shortest side in CSS px', () => {
    // 50mm × 40mm → shortest 40mm
    expect(maxCornerRadiusPx(50, 40)).toBeCloseTo((40 * MM_TO_PX) / 2);
    expect(maxCornerRadiusPx(10, 100)).toBeCloseTo((10 * MM_TO_PX) / 2);
  });

  it('radiusHandleInsetPx uses min clearance so handles clear resize corners', () => {
    expect(radiusHandleInsetPx(0, 1)).toBe(14);
    expect(radiusHandleInsetPx(12, 1)).toBe(14);
    expect(radiusHandleInsetPx(20, 1)).toBe(20);
    // Under CSS camera zoom, min clearance shrinks in layout px.
    expect(radiusHandleInsetPx(0, 2)).toBe(7);
  });

  it('projects drag toward center as positive delta per corner', () => {
    expect(projectRadiusDelta('tl', 10, 10)).toBeGreaterThan(0);
    expect(projectRadiusDelta('tl', -10, -10)).toBeLessThan(0);
    expect(projectRadiusDelta('tr', -10, 10)).toBeGreaterThan(0);
    expect(projectRadiusDelta('br', -10, -10)).toBeGreaterThan(0);
    expect(projectRadiusDelta('bl', 10, -10)).toBeGreaterThan(0);
  });

  it('computeRadiusFromDrag clamps to [0, max]', () => {
    expect(computeRadiusFromDrag(0, 'tl', 1000, 1000, 20)).toBe(20);
    expect(computeRadiusFromDrag(10, 'tl', -1000, -1000, 50)).toBe(0);
  });

  it('clampCornerRadiusPx rejects non-finite', () => {
    expect(clampCornerRadiusPx(Number.NaN, 10)).toBe(0);
  });

  it('layerSupportsCornerRadius matches panel eligibility', () => {
    expect(layerSupportsCornerRadius(createLayer('rect'))).toBe(true);
    expect(layerSupportsCornerRadius(createLayer('ellipse'))).toBe(true);
    expect(layerSupportsCornerRadius(createLayer('text'))).toBe(true);
    expect(layerSupportsCornerRadius(createLayer('line'))).toBe(false);
    expect(layerSupportsCornerRadius(createLayer('polygon'))).toBe(false);
    expect(layerSupportsCornerRadius(createLayer('star'))).toBe(false);
  });

  it('uniform apply writes --border-radius and clears per-corner keys', () => {
    const layer = createLayer('rect', {
      cssVars: {
        ...createLayer('rect').cssVars,
        '--radius-tl': '4px',
        '--radius-tr': '8px',
      },
    });
    const next = applyCornerRadiusDrag(layer, 'tl', 12, { independent: false });
    expect(next.cssVars['--border-radius']).toBe('12px');
    expect(next.cssVars['--radius-tl']).toBeUndefined();
    expect(next.cssVars['--radius-tr']).toBeUndefined();
    expect(next.cssVars['--radius-br']).toBeUndefined();
    expect(next.cssVars['--radius-bl']).toBeUndefined();
  });

  it('independent apply sets only the active corner and preserves others', () => {
    const layer = createLayer('rect', {
      cssVars: {
        ...createLayer('rect').cssVars,
        '--border-radius': '5px',
      },
    });
    const next = applyCornerRadiusDrag(layer, 'tr', 15, { independent: true });
    expect(next.cssVars['--border-radius']).toBeUndefined();
    expect(cornerRadiusPx(next.cssVars, 'tr')).toBe(15);
    expect(cornerRadiusPx(next.cssVars, 'tl')).toBe(5);
    expect(cornerRadiusPx(next.cssVars, 'br')).toBe(5);
    expect(cornerRadiusPx(next.cssVars, 'bl')).toBe(5);
  });

  it('layersWithCornerRadius patches by id', () => {
    const a = createLayer('rect');
    const b = createLayer('rect');
    const next = layersWithCornerRadius([a, b], a.id, 'tl', 8, { independent: false });
    expect(next.find((l) => l.id === a.id)!.cssVars['--border-radius']).toBe('8px');
    expect(next.find((l) => l.id === b.id)).toBe(b);
  });
});
