import { describe, expect, it } from 'vitest';
import { createLayer } from '../constants';
import { buildLineSvgContent } from '../ops/lineSvg';
import type { CanvasLayer } from '../types';

/** Helper: a line layer with default geometry and optional cssVar overrides. */
function lineLayer(overrides: Record<string, string | undefined> = {}): CanvasLayer {
  const layer = createLayer('line');
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) {
      delete layer.cssVars[k as keyof typeof layer.cssVars];
    } else {
      layer.cssVars[k as keyof typeof layer.cssVars] = v;
    }
  }
  return layer;
}

describe('buildLineSvgContent', () => {
  it('emits an <svg> with a <path> for a valid line', () => {
    const svg = buildLineSvgContent(lineLayer());
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('</svg>');
    expect(svg).toContain('<path');
    expect(svg).toContain('fill="none"');
    expect(svg).toContain('stroke="#000000');
  });

  it('injects <defs> with a marker when --stroke-start is "arrow"', () => {
    const svg = buildLineSvgContent(lineLayer({ '--stroke-start': 'arrow' }));
    expect(svg).toContain('<defs>');
    expect(svg).toContain('<marker');
    expect(svg).toContain('marker-start=');
  });

  it('injects a marker when --stroke-end is "arrow"', () => {
    const svg = buildLineSvgContent(lineLayer({ '--stroke-end': 'arrow' }));
    expect(svg).toContain('<defs>');
    expect(svg).toContain('marker-end=');
  });

  it('omits the <path> when --stroke-visible is "0"', () => {
    const svg = buildLineSvgContent(lineLayer({ '--stroke-visible': '0' }));
    expect(svg).toContain('<svg');
    expect(svg).not.toContain('<path');
    expect(svg).not.toContain('<defs>');
  });

  it('adds stroke-dasharray when --stroke-dash is set', () => {
    const svg = buildLineSvgContent(lineLayer({ '--stroke-dash': 'dashed' }));
    expect(svg).toContain('stroke-dasharray=');
  });

  it('does not inject unescaped markup from a hostile layer id into marker ids', () => {
    // The marker id is sanitized to [a-zA-Z0-9_-]; special chars are stripped, so
    // no raw <, >, or " leak into the <defs><marker> block.
    const layer = lineLayer({ '--stroke-end': 'arrow' });
    layer.id = 'x"><script>alert(1)</script>';
    const svg = buildLineSvgContent(layer);
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('<marker');
  });
});
