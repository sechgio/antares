import type { LayerCssVars } from '../types';
import { scaleCssLength } from './drawHelpers';
import { cssVarsToStyleParts, scaleBorderRadius } from './layerStyle';

export const DEFAULT_LAYER_FONT = "'Segoe UI', 'Helvetica Neue', Arial, sans-serif";
export const DEFAULT_LAYER_COLOR = '#1e1e1e';
export const DEFAULT_LINE_HEIGHT = '1.2';

/** Scale length-like cssVars so cssVarsToStyleParts matches zoomed LayerNode paint. */
export function scaleCssVarsForZoom(vars: LayerCssVars, scale: number): LayerCssVars {
  if (scale === 1) return vars;
  const next: LayerCssVars = { ...vars };
  const scaleKey = (key: keyof LayerCssVars) => {
    const raw = next[key];
    if (!raw) return;
    const scaled = scaleCssLength(raw, scale);
    if (scaled) next[key] = scaled;
  };
  scaleKey('--font-size');
  scaleKey('--border-width');
  scaleKey('--filter-blur');
  if (next['--border-radius']) {
    next['--border-radius'] = scaleBorderRadius(next['--border-radius'], scale) || next['--border-radius'];
  }
  for (const key of ['--radius-tl', '--radius-tr', '--radius-br', '--radius-bl'] as const) {
    if (next[key]) next[key] = scaleBorderRadius(next[key], scale) || next[key];
  }
  if (next['--border']) {
    next['--border'] = next['--border'].replace(/(-?[\d.]+)px/g, (_, n: string) => {
      return `${Math.round(Number(n) * scale)}px`;
    });
  }
  if (next['--box-shadow'] && next['--box-shadow'] !== 'none') {
    next['--box-shadow'] = next['--box-shadow'].replace(/(-?[\d.]+)px/g, (_, n: string) => {
      return `${Math.round(Number(n) * scale)}px`;
    });
  }
  return next;
}

/** Convert `prop:value` declarations from cssVarsToStyleParts into a style map. */
export function cssDeclarationsToStyle(parts: string[]): Record<string, string> {
  const style: Record<string, string> = {};
  for (const part of parts) {
    const i = part.indexOf(':');
    if (i < 0) continue;
    const prop = part.slice(0, i).trim();
    const value = part.slice(i + 1).trim();
    if (!prop || !value) continue;
    const camel = prop.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    style[camel] = value;
  }
  return style;
}

/**
 * Paint styles shared by LayerNode and HTML export (fill, stroke, type, shadow…).
 * Position/size and editor chrome (selection) stay outside.
 */
export function buildLayerPaintStyle(
  vars: LayerCssVars,
  options?: { scale?: number; defaults?: Partial<LayerCssVars> },
): Record<string, string> {
  const scale = options?.scale ?? 1;
  const merged: LayerCssVars = {
    ...(options?.defaults ?? {}),
    ...vars,
  };
  if (!merged['--color']) merged['--color'] = DEFAULT_LAYER_COLOR;
  if (!merged['--font-family']) merged['--font-family'] = DEFAULT_LAYER_FONT;
  if (!merged['--font-size']) {
    merged['--font-size'] = scaleCssLength('11px', scale) || '11px';
  }
  const scaled = scaleCssVarsForZoom(merged, scale);
  return cssDeclarationsToStyle(cssVarsToStyleParts(scaled));
}
