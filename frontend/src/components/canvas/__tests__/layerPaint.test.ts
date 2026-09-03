import { describe, expect, it } from 'vitest';
import {
  buildLayerPaintStyle,
  cssDeclarationsToStyle,
  DEFAULT_LAYER_COLOR,
  DEFAULT_LAYER_FONT,
  keepSpreadOnlyShadows,
  scaleCssVarsForZoom,
} from '../ops/layerPaint';
import type { LayerCssVars } from '../types';

function vars(partial: Partial<LayerCssVars>): LayerCssVars {
  return { '--width': '10mm', '--height': '10mm', '--translate-x': '0mm', '--translate-y': '0mm', ...partial };
}

describe('scaleCssVarsForZoom', () => {
  it('returns the input unchanged when scale is 1', () => {
    const v = vars({ '--font-size': '11px', '--border-width': '1px' });
    expect(scaleCssVarsForZoom(v, 1)).toBe(v);
  });

  it('scales px lengths in --font-size, --border-width, --filter-blur', () => {
    const v = vars({ '--font-size': '11px', '--border-width': '1px', '--filter-blur': '4px' });
    const out = scaleCssVarsForZoom(v, 2);
    expect(out['--font-size']).toBe('22px');
    expect(out['--border-width']).toBe('2px');
    expect(out['--filter-blur']).toBe('8px');
  });

  it('scales --border-radius and per-corner radii', () => {
    const v = vars({
      '--border-radius': '10px',
      '--radius-tl': '2px',
      '--radius-tr': '3px',
      '--radius-br': '4px',
      '--radius-bl': '5px',
    });
    const out = scaleCssVarsForZoom(v, 2);
    expect(out['--border-radius']).toBe('20px');
    expect(out['--radius-tl']).toBe('4px');
    expect(out['--radius-tr']).toBe('6px');
    expect(out['--radius-br']).toBe('8px');
    expect(out['--radius-bl']).toBe('10px');
  });

  it('scales px values inside --border and --box-shadow', () => {
    const v = vars({ '--border': '2px solid #000', '--box-shadow': '4px 4px 2px rgba(0,0,0,0.5)' });
    const out = scaleCssVarsForZoom(v, 2);
    expect(out['--border']).toBe('4px solid #000');
    expect(out['--box-shadow']).toBe('8px 8px 4px rgba(0,0,0,0.5)');
  });

  it('leaves non-length cssVars untouched', () => {
    const v = vars({ '--background-color': '#ff0000', '--opacity': '50' });
    const out = scaleCssVarsForZoom(v, 2);
    expect(out['--background-color']).toBe('#ff0000');
    expect(out['--opacity']).toBe('50');
  });
});

describe('cssDeclarationsToStyle', () => {
  it('parses "prop:value" into a camelCase style map', () => {
    expect(cssDeclarationsToStyle(['color:red', 'font-size:12px'])).toEqual({ color: 'red', fontSize: '12px' });
  });

  it('skips malformed parts (no colon, empty value, empty prop)', () => {
    expect(cssDeclarationsToStyle(['nope', 'color:', ':red', 'color:red'])).toEqual({ color: 'red' });
  });
});

describe('buildLayerPaintStyle', () => {
  it('applies default --color, --font-family, --font-size when missing', () => {
    const style = buildLayerPaintStyle(vars({}));
    expect(style.color).toBe(DEFAULT_LAYER_COLOR);
    expect(style.fontFamily).toBe(DEFAULT_LAYER_FONT);
    expect(style.fontSize).toBe('11px');
  });

  it('keeps provided values instead of defaults', () => {
    const style = buildLayerPaintStyle(vars({ '--color': '#123456', '--font-family': 'serif', '--font-size': '20px' }));
    expect(style.color).toBe('#123456');
    expect(style.fontFamily).toBe('serif');
    expect(style.fontSize).toBe('20px');
  });

  it('merges the defaults option under the provided vars', () => {
    const style = buildLayerPaintStyle(vars({ '--color': '#abc' }), {
      defaults: { '--color': '#fallback', '--opacity': '80' } as LayerCssVars,
    });
    expect(style.color).toBe('#abc');
    expect(style.opacity).toBe('0.8');
  });

  it('scales the default font-size when scale > 1 (single-scale only)', () => {
    const style = buildLayerPaintStyle(vars({}), { scale: 2 });
    expect(style.fontSize).toBe('22px');
  });
});

describe('keepSpreadOnlyShadows', () => {
  it('keeps a spread-only shadow (frame/stroke) and drops blurred/offset ones', () => {
    const combined = '0 10px 20px rgba(0,0,0,0.5), 0 0 0 2px #000000';
    expect(keepSpreadOnlyShadows(combined)).toBe('0 0 0 2px #000000');
  });

  it('returns empty when all shadows are blurred/offset', () => {
    expect(keepSpreadOnlyShadows('4px 4px 2px rgba(0,0,0,0.5)')).toBe('');
  });

  it('returns the shadow unchanged when it is already spread-only', () => {
    expect(keepSpreadOnlyShadows('0 0 0 3px rgba(255,0,0,1)')).toBe('0 0 0 3px rgba(255,0,0,1)');
  });

  it('handles rgba() commas without splitting inside parens', () => {
    const combined = '0 5px 10px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(255,255,255,0.8)';
    expect(keepSpreadOnlyShadows(combined)).toBe('0 0 0 1px rgba(255,255,255,0.8)');
  });

  it('returns empty for an empty string', () => {
    expect(keepSpreadOnlyShadows('')).toBe('');
  });
});
