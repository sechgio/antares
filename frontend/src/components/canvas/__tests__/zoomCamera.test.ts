import { describe, expect, it } from 'vitest';
import { buildLayerPaintStyle } from '../ops/layerPaint';
import { A4_HEIGHT_PX, A4_WIDTH_PX } from '../types';

describe('Figma-like zoom camera (layout invariant)', () => {
  it('design-resolution paint ignores camera zoom (always scale=1)', () => {
    const vars = { '--font-size': '9pt', '--border-width': '2px', '--color': '#111' };
    const design = buildLayerPaintStyle(vars, { scale: 1 });
    expect(design.fontSize).toBe('9pt');
    expect(design.border || design.outline || '').toMatch(/2px/);
  });

  it('A4 design canvas is 210x297 mm at 96 dpi', () => {
    expect(A4_WIDTH_PX).toBe(Math.round((210 * 96) / 25.4));
    expect(A4_HEIGHT_PX).toBe(Math.round((297 * 96) / 25.4));
  });
});
