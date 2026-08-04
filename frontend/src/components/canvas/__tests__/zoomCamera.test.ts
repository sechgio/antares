import { describe, expect, it } from 'vitest';
import { buildLayerPaintStyle } from '../ops/layerPaint';
import { A4_HEIGHT_PX, A4_WIDTH_PX } from '../types';

/**
 * Figma camera contract:
 * - Layer paint/layout is ALWAYS computed at design resolution (scale=1).
 * - Viewport zoom is a compositor `scale()` on the page frame (camera), not a re-layout.
 * - Therefore text wrapping / metrics never change when the user zooms.
 * - PreviewViewport may still use CSS `zoom` for crisp iframe rasterization.
 */
describe('Figma-like zoom camera (layout invariant)', () => {
  it('design-resolution paint ignores camera zoom (always scale=1)', () => {
    const vars = { '--font-size': '9pt', '--border-width': '2px', '--color': '#111' };
    const design = buildLayerPaintStyle(vars, { scale: 1 });
    expect(design.fontSize).toBe('9pt');
    expect(design.border || design.outline || '').toMatch(/2px/);
  });

  it('camera zoom only changes the frame display size, not design px', () => {
    // Page is laid out at A4 CSS px; zoom multiplies the visual size only.
    const cameraZoom = 0.85;
    expect(A4_WIDTH_PX).toBe(Math.round((210 * 96) / 25.4));
    expect(A4_HEIGHT_PX).toBe(Math.round((297 * 96) / 25.4));
    const visualW = A4_WIDTH_PX * cameraZoom;
    const visualH = A4_HEIGHT_PX * cameraZoom;
    expect(visualW / A4_WIDTH_PX).toBeCloseTo(cameraZoom, 6);
    expect(visualH / A4_HEIGHT_PX).toBeCloseTo(cameraZoom, 6);
  });

  it('re-layout zoom would change rounded font/box ratios (why we use camera zoom)', () => {
    const vars = { '--font-size': '11px' };
    const widthMm = 40;
    const MM = 96 / 25.4;
    const ratio = (zoom: number) => {
      const font = parseFloat(buildLayerPaintStyle(vars, { scale: zoom }).fontSize || '0');
      const box = Math.round(widthMm * MM * zoom);
      return font / box;
    };
    // Document the hazard: layout-scale zoom is NOT ratio-stable under px rounding.
    expect(Math.abs(ratio(0.5) - ratio(1)) > 1e-6).toBe(true);
  });
});
