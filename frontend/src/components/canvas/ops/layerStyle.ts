import type { CanvasLayer, CanvasLayerType, LayerCssVars } from '../types';
import { mm, parseMm } from '../types';
import { MM_TO_PX } from './drawHelpers';

/** Default Figma-like stroke weight for new lines (CSS px at 96dpi). */
export const DEFAULT_LINE_STROKE_PX = 1;

/**
 * Free stroke weight range (CSS px), aligned with Canva (0–100) and Figma's free numeric entry.
 * Arrow/spinner step matches Figma's fine control (0.1px).
 */
export const STROKE_WEIGHT_MIN_PX = 0;
export const STROKE_WEIGHT_MAX_PX = 100;
export const STROKE_WEIGHT_STEP_PX = 0.1;

/** Session last-used weight (Figma/Canva-like) for the next line insert. */
let lastStrokeWeightPx = DEFAULT_LINE_STROKE_PX;

/** Clamp and round stroke weight to two decimals within the allowed range. */
export function clampStrokeWeight(px: number): number {
  if (!Number.isFinite(px)) return DEFAULT_LINE_STROKE_PX;
  return (
    Math.round(Math.min(STROKE_WEIGHT_MAX_PX, Math.max(STROKE_WEIGHT_MIN_PX, px)) * 100) / 100
  );
}

/** Remember a positive stroke weight for subsequent line inserts. */
export function rememberStrokeWeight(px: number): void {
  const weight = clampStrokeWeight(px);
  if (weight > 0) lastStrokeWeightPx = weight;
}

/** Stroke weight to apply when placing a new line with the line tool. */
export function strokeWeightForNewLine(): number {
  return lastStrokeWeightPx > 0 ? lastStrokeWeightPx : DEFAULT_LINE_STROKE_PX;
}

/** Reset session last-used weight (tests / explicit restore). */
export function resetLastStrokeWeight(px = DEFAULT_LINE_STROKE_PX): void {
  lastStrokeWeightPx = clampStrokeWeight(px) || DEFAULT_LINE_STROKE_PX;
}

export function pxToMm(px: number): number {
  return px / MM_TO_PX;
}

export function mmToPxLength(mmVal: number): number {
  return mmVal * MM_TO_PX;
}

export function parseBorderWidthPx(vars: LayerCssVars, fallback = 0): number {
  const raw = vars['--border-width'];
  if (raw == null || raw === '') return fallback;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? clampStrokeWeight(n) : fallback;
}

/** Stroke weight in px for a line. Legacy lines (no --border-width) use fill height. */
export function lineStrokeWidthPx(layer: Pick<CanvasLayer, 'type' | 'cssVars'>): number {
  if (layer.cssVars['--border-width'] != null && layer.cssVars['--border-width'] !== '') {
    return parseBorderWidthPx(layer.cssVars, DEFAULT_LINE_STROKE_PX);
  }
  if (layer.type === 'line') {
    const h = parseMm(layer.cssVars['--height'], 0);
    if (h > 0) return clampStrokeWeight(mmToPxLength(h));
  }
  return DEFAULT_LINE_STROKE_PX;
}

export function lineHeightMmFromStrokePx(px: number): number {
  return Math.max(0.05, pxToMm(Math.max(0, px)));
}

/**
 * Persist stroke weight for lines.
 * Path-based lines keep their bbox height; legacy bar-lines sync --height to weight.
 */
export function applyLineStrokeWeight(layer: CanvasLayer, px: number): CanvasLayer {
  const weight = clampStrokeWeight(px);
  if (weight > 0) rememberStrokeWeight(weight);
  const hasPath = Boolean(layer.meta?.path?.points && layer.meta.path.points.length >= 2);
  return {
    ...layer,
    cssVars: {
      ...layer.cssVars,
      '--border-width': `${weight}px`,
      ...(hasPath
        ? {}
        : { '--height': mm(lineHeightMmFromStrokePx(weight > 0 ? weight : 0.25)) }),
      '--stroke-visible': weight > 0 ? '1' : '0',
      '--stroke-align': layer.cssVars['--stroke-align'] || 'center',
      '--border-color': layer.cssVars['--border-color'] || '#000000',
    },
  };
}

/** Paint color for a line bar (stroke color, with legacy fill fallback). */
export function resolveLineFillColor(vars: LayerCssVars): string {
  if (vars['--stroke-visible'] === '0') return 'transparent';
  const hex =
    (vars['--border-color'] && vars['--border-color'] !== 'transparent'
      ? vars['--border-color']
      : null) ||
    (vars['--background-color'] && vars['--background-color'] !== 'transparent'
      ? vars['--background-color']
      : '#000000');
  const opacity = Number(vars['--stroke-opacity'] ?? vars['--fill-opacity'] ?? 100);
  return hexToRgba(normalizeHex(hex, '#000000'), Number.isFinite(opacity) ? opacity : 100);
}

/**
 * Normalize line cssVars to a filled bar for editor/export (no CSS border stroke).
 * Thickness comes from --border-width; legacy lines keep fill-height appearance.
 */
export function lineVisualCssVars(vars: LayerCssVars): LayerCssVars {
  const hasStrokeWidth = vars['--border-width'] != null && vars['--border-width'] !== '';
  const strokePx = hasStrokeWidth
    ? parseBorderWidthPx(vars, DEFAULT_LINE_STROKE_PX)
    : Math.round(mmToPxLength(parseMm(vars['--height'], pxToMm(DEFAULT_LINE_STROKE_PX))) * 100) / 100;
  const heightMm = hasStrokeWidth
    ? lineHeightMmFromStrokePx(strokePx)
    : Math.max(0.05, parseMm(vars['--height'], lineHeightMmFromStrokePx(DEFAULT_LINE_STROKE_PX)));
  const color =
    (vars['--border-color'] && vars['--border-color'] !== 'transparent'
      ? vars['--border-color']
      : null) ||
    (vars['--background-color'] && vars['--background-color'] !== 'transparent'
      ? vars['--background-color']
      : '#000000');
  if (vars['--stroke-visible'] === '0') {
    return {
      ...vars,
      '--height': mm(heightMm),
      '--background-color': 'transparent',
      '--fill-visible': '0',
      '--border-width': '0px',
      '--stroke-visible': '0',
    };
  }
  return {
    ...vars,
    '--height': mm(heightMm),
    '--background-color': color,
    '--fill-visible': '1',
    '--fill-opacity': vars['--stroke-opacity'] ?? vars['--fill-opacity'] ?? '100',
    '--border-width': '0px',
    '--stroke-visible': '0',
  };
}

export const SHAPE_TYPES = new Set<CanvasLayerType>([
  'rect',
  'ellipse',
  'line',
  'arrow',
  'polygon',
  'star',
]);

export const LAYER_TYPE_LABELS: Record<CanvasLayerType, string> = {
  text: 'Texto',
  image: 'Imagen',
  frame: 'Página',
  field: 'Campo',
  logo: 'Logo',
  imageSlot: 'Slot de foto',
  rect: 'Rectángulo',
  grid: 'Cuadrícula',
  group: 'Grupo',
  table: 'Tabla',
  checkbox: 'Casilla',
  signature: 'Firma',
  line: 'Línea',
  ellipse: 'Elipse',
  arrow: 'Flecha',
  polygon: 'Polígono',
  star: 'Estrella',
};

export function isShapeLayer(layer: CanvasLayer): boolean {
  return SHAPE_TYPES.has(layer.type);
}

export function layerPanelTitle(layer: CanvasLayer): string {
  const defaultName = LAYER_TYPE_LABELS[layer.type] || layer.type;
  if (!layer.name || layer.name === defaultName) return defaultName;
  // English defaults from createLayer
  const englishDefaults: Record<string, string> = {
    Rectangle: 'Rectángulo',
    Ellipse: 'Elipse',
    Line: 'Línea',
    Arrow: 'Flecha',
    Polygon: 'Polígono',
    Star: 'Estrella',
  };
  if (englishDefaults[layer.name]) return englishDefaults[layer.name];
  return layer.name;
}

export function parseScale(value: string | undefined): number {
  const n = Number(value ?? 1);
  return n === -1 ? -1 : 1;
}

export function buildLayerTransform(vars: LayerCssVars): string | undefined {
  const rotate = vars['--rotate'] || '0deg';
  const sx = parseScale(vars['--scale-x']);
  const sy = parseScale(vars['--scale-y']);
  const parts: string[] = [];
  if (rotate !== '0deg') parts.push(`rotate(${rotate})`);
  if (sx !== 1) parts.push(`scaleX(${sx})`);
  if (sy !== 1) parts.push(`scaleY(${sy})`);
  return parts.length ? parts.join(' ') : undefined;
}

export function clampOpacity(n: number): number {
  return Math.min(100, Math.max(0, Math.round(n)));
}

export function hexToRgba(hex: string, opacityPct: number): string {
  const clean = hex.replace('#', '').trim();
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean.slice(0, 6);
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return hex;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  const a = clampOpacity(opacityPct) / 100;
  if (a >= 1) return `#${full.toUpperCase()}`;
  return `rgba(${r},${g},${b},${a})`;
}

export function normalizeHex(value: string | undefined, fallback = '#FFFFFF'): string {
  if (!value || value === 'transparent') return fallback;
  const m = value.trim().match(/^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
  if (!m) {
    const rgb = value.trim().match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
    if (rgb) {
      const toHex = (n: string) => Number(n).toString(16).padStart(2, '0');
      return `#${toHex(rgb[1])}${toHex(rgb[2])}${toHex(rgb[3])}`.toUpperCase();
    }
    return fallback;
  }
  const raw = m[1];
  const full =
    raw.length === 3
      ? raw
          .split('')
          .map((c) => c + c)
          .join('')
      : raw;
  return `#${full.toUpperCase()}`;
}

export function resolveFillColor(vars: LayerCssVars): string {
  if (vars['--fill-visible'] === '0') return 'transparent';
  const hex = vars['--background-color'];
  if (!hex || hex === 'transparent') return 'transparent';
  const opacity = Number(vars['--fill-opacity'] ?? 100);
  return hexToRgba(normalizeHex(hex), Number.isFinite(opacity) ? opacity : 100);
}

/** CSS `background` value — solid rgba, linear-gradient, or radial-gradient. */
export function resolveFillBackground(vars: LayerCssVars): string {
  if (vars['--fill-visible'] === '0') return 'transparent';
  const type = vars['--fill-type'] || 'solid';
  if (type !== 'linear' && type !== 'radial') return resolveFillColor(vars);

  const hex1 = vars['--background-color'];
  if (!hex1 || hex1 === 'transparent') return 'transparent';
  const opacity = Number(vars['--fill-opacity'] ?? 100);
  const op = Number.isFinite(opacity) ? opacity : 100;
  const c1 = hexToRgba(normalizeHex(hex1), op);
  const hex2 = vars['--fill-color-2'] || hex1;
  const c2 = hexToRgba(normalizeHex(hex2, '#000000'), op);
  if (type === 'radial') return `radial-gradient(circle at center, ${c1}, ${c2})`;
  const angle = Number.parseFloat(vars['--fill-angle'] || '180');
  const deg = Number.isFinite(angle) ? angle : 180;
  return `linear-gradient(${deg}deg, ${c1}, ${c2})`;
}

export function parseFilterBlurPx(vars: LayerCssVars): number {
  const raw = vars['--filter-blur'];
  if (!raw || raw === 'none') return 0;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? Math.max(0, Math.min(40, n)) : 0;
}

export function resolveFilter(vars: LayerCssVars): string | undefined {
  const blur = parseFilterBlurPx(vars);
  if (blur <= 0) return undefined;
  return `blur(${blur}px)`;
}

export function parseImageZoom(vars: LayerCssVars): number {
  const n = Number.parseFloat(vars['--image-zoom'] || '1');
  if (!Number.isFinite(n)) return 1;
  return Math.min(3, Math.max(1, Math.round(n * 100) / 100));
}

/** Inline CSS for <img> content (editor + PDF export). */
export function imageContentInlineStyle(vars: LayerCssVars): string {
  const fit = vars['--object-fit'] || 'cover';
  const pos = vars['--object-position'] || '50% 50%';
  const zoom = parseImageZoom(vars);
  const parts = [
    'width:100%',
    'height:100%',
    `object-fit:${fit}`,
    `object-position:${pos}`,
  ];
  if (zoom !== 1) {
    parts.push(`transform:scale(${zoom})`);
    parts.push(`transform-origin:${pos}`);
  }
  return parts.join(';');
}

export type CornerId = 'tl' | 'tr' | 'br' | 'bl';

export function parseRadiusPx(value: string | undefined): number {
  if (!value || value.includes('%')) return 0;
  const n = parseFloat(value);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

/** Resolved CSS border-radius (1 or 4 values). */
export function resolveBorderRadius(vars: LayerCssVars): string {
  const uniform = vars['--border-radius'];
  const tl = vars['--radius-tl'];
  const tr = vars['--radius-tr'];
  const br = vars['--radius-br'];
  const bl = vars['--radius-bl'];
  const hasCorners = Boolean(tl || tr || br || bl);
  if (!hasCorners) return uniform || '0px';
  const fallback = uniform || '0px';
  const a = tl || fallback;
  const b = tr || fallback;
  const c = br || fallback;
  const d = bl || fallback;
  if (a === b && b === c && c === d) return a;
  return `${a} ${b} ${c} ${d}`;
}

export function cornerRadiusPx(vars: LayerCssVars, corner: CornerId): number {
  const key = `--radius-${corner}` as const;
  const specific = vars[key];
  if (specific) return parseRadiusPx(specific);
  return parseRadiusPx(vars['--border-radius']);
}

/** Scale a 1–4 value border-radius string by zoom (skips %). */
export function scaleBorderRadius(value: string | undefined, scale: number): string | undefined {
  if (!value) return undefined;
  return value
    .trim()
    .split(/\s+/)
    .map((part) => {
      if (part.includes('%')) return part;
      const match = /^(-?[\d.]+)([a-z]*)$/i.exec(part);
      if (!match) return part;
      const n = Number(match[1]);
      if (!Number.isFinite(n)) return part;
      const unit = match[2] || 'px';
      const scaled = n * scale;
      const snapped = unit === 'px' || unit === '' ? Math.round(scaled) : scaled;
      return `${snapped}${unit || 'px'}`;
    })
    .join(' ');
}

export type StrokeAlign = 'inside' | 'center' | 'outside';

export function parseStrokeAlign(value: string | undefined): StrokeAlign {
  if (value === 'center' || value === 'outside') return value;
  return 'inside';
}

export type StrokeDash = 'solid' | 'dashed' | 'dotted';

export function parseStrokeDash(value: string | undefined): StrokeDash {
  if (value === 'dashed' || value === 'dotted') return value;
  return 'solid';
}

/** SVG stroke-dasharray in mm (viewBox units). */
export function strokeDasharrayMm(dash: StrokeDash, strokeWidthMm: number): string | undefined {
  if (dash === 'solid') return undefined;
  const w = Math.max(0.05, strokeWidthMm);
  if (dash === 'dotted') return `0 ${w * 2.2}`;
  return `${w * 3} ${w * 2}`;
}

export interface StrokeStyle {
  border?: string;
  outline?: string;
  outlineOffset?: string;
  boxShadowExtra?: string;
}

export function resolveStrokeStyle(
  vars: LayerCssVars,
  scaledWidth?: string,
): StrokeStyle {
  if (vars['--stroke-visible'] === '0') return {};
  const width = scaledWidth || vars['--border-width'] || '0px';
  const wNum = parseFloat(width) || 0;
  if (wNum <= 0 && !vars['--border']) return {};

  const colorRaw = vars['--border-color'] || '#000000';
  const opacity = Number(vars['--stroke-opacity'] ?? 100);
  const color = hexToRgba(normalizeHex(colorRaw, '#000000'), Number.isFinite(opacity) ? opacity : 100);
  const align = parseStrokeAlign(vars['--stroke-align']);
  const dash = parseStrokeDash(vars['--stroke-dash']);
  const lineStyle = dash === 'solid' ? 'solid' : dash;

  if (vars['--border']) {
    return { border: vars['--border'] };
  }

  if (align === 'center') {
    return {
      outline: `${width} ${lineStyle} ${color}`,
      outlineOffset: `-${wNum / 2}px`,
    };
  }
  if (align === 'outside') {
    // box-shadow cannot dash; fall back to outline outside the box.
    if (dash !== 'solid') {
      return {
        outline: `${width} ${lineStyle} ${color}`,
        outlineOffset: '0px',
      };
    }
    return {
      boxShadowExtra: `0 0 0 ${width} ${color}`,
    };
  }
  return { border: `${width} ${lineStyle} ${color}` };
}

export function toggleFlip(layer: CanvasLayer, axis: 'x' | 'y'): CanvasLayer {
  const key = axis === 'x' ? '--scale-x' : '--scale-y';
  const current = parseScale(layer.cssVars[key]);
  return {
    ...layer,
    cssVars: {
      ...layer.cssVars,
      [key]: String(current === -1 ? 1 : -1),
    },
  };
}

export function isAspectLocked(vars: LayerCssVars): boolean {
  return vars['--aspect-locked'] === '1';
}

export function resizeWithAspectLock(
  layer: CanvasLayer,
  dim: 'width' | 'height',
  nextMm: number,
): CanvasLayer {
  if (layer.type === 'line') {
    const hasPath = Boolean(layer.meta?.path?.points && layer.meta.path.points.length >= 2);
    if (dim === 'width') {
      return {
        ...layer,
        cssVars: {
          ...layer.cssVars,
          '--width': mm(Math.max(0.5, nextMm)),
        },
      };
    }
    if (hasPath) {
      return {
        ...layer,
        cssVars: {
          ...layer.cssVars,
          '--height': mm(Math.max(0.5, nextMm)),
        },
      };
    }
    return applyLineStrokeWeight(layer, Math.max(0, mmToPxLength(nextMm)));
  }

  const w = parseMm(layer.cssVars['--width'], 10);
  const h = parseMm(layer.cssVars['--height'], 10);
  const locked = isAspectLocked(layer.cssVars);
  const value = Math.max(1, nextMm);

  if (!locked || w <= 0 || h <= 0) {
    return {
      ...layer,
      cssVars: {
        ...layer.cssVars,
        [dim === 'width' ? '--width' : '--height']: mm(value),
      },
    };
  }

  const ratio = w / h;
  if (dim === 'width') {
    return {
      ...layer,
      cssVars: {
        ...layer.cssVars,
        '--width': mm(value),
        '--height': mm(Math.max(1, value / ratio)),
      },
    };
  }
  return {
    ...layer,
    cssVars: {
      ...layer.cssVars,
      '--height': mm(value),
      '--width': mm(Math.max(1, value * ratio)),
    },
  };
}

export interface ParsedShadow {
  color: string;
  x: number;
  y: number;
  blur: number;
  opacity: number;
}

export const DEFAULT_SHADOW: ParsedShadow = {
  color: '#000000',
  x: 0,
  y: 4,
  blur: 8,
  opacity: 25,
};

export function parseBoxShadow(value: string | undefined): ParsedShadow | null {
  if (!value || value === 'none') return null;
  // e.g. "0px 4px 8px rgba(0,0,0,0.25)" or "0 4px 8px #00000040"
  const rgba = value.match(
    /(-?[\d.]+)px\s+(-?[\d.]+)px\s+([\d.]+)px\s+rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/i,
  );
  if (rgba) {
    const a = rgba[7] != null ? Number(rgba[7]) : 1;
    const toHex = (n: string) => Number(n).toString(16).padStart(2, '0');
    return {
      x: Number(rgba[1]),
      y: Number(rgba[2]),
      blur: Number(rgba[3]),
      color: `#${toHex(rgba[4])}${toHex(rgba[5])}${toHex(rgba[6])}`.toUpperCase(),
      opacity: clampOpacity(a * 100),
    };
  }
  const hex = value.match(/(-?[\d.]+)px\s+(-?[\d.]+)px\s+([\d.]+)px\s+(#[0-9a-fA-F]{3,8})/);
  if (hex) {
    return {
      x: Number(hex[1]),
      y: Number(hex[2]),
      blur: Number(hex[3]),
      color: normalizeHex(hex[4], '#000000'),
      opacity: 100,
    };
  }
  return { ...DEFAULT_SHADOW };
}

export function formatBoxShadow(shadow: ParsedShadow): string {
  const color = hexToRgba(shadow.color, shadow.opacity);
  return `${shadow.x}px ${shadow.y}px ${shadow.blur}px ${color}`;
}

export function collectDocumentColors(layers: CanvasLayer[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const layer of layers) {
    for (const key of ['--background-color', '--fill-color-2', '--border-color', '--color'] as const) {
      const raw = layer.cssVars[key];
      if (!raw || raw === 'transparent') continue;
      const hex = normalizeHex(raw, '');
      if (!hex || seen.has(hex)) continue;
      seen.add(hex);
      out.push(hex);
    }
  }
  return out.slice(0, 24);
}

/** Build CSS declarations shared by editor + HTML export. */
export function cssVarsToStyleParts(vars: LayerCssVars): string[] {
  const skip = new Set([
    '--translate-x',
    '--translate-y',
    '--width',
    '--height',
    '--rotate',
    '--scale-x',
    '--scale-y',
    '--fill-opacity',
    '--fill-visible',
    '--fill-type',
    '--fill-color-2',
    '--fill-angle',
    '--filter-blur',
    '--image-zoom',
    '--object-position',
    '--stroke-opacity',
    '--stroke-visible',
    '--stroke-align',
    '--stroke-dash',
    '--aspect-locked',
    '--box-shadow',
    '--background-color',
    '--border-width',
    '--border-color',
    '--border',
    '--border-radius',
    '--radius-tl',
    '--radius-tr',
    '--radius-br',
    '--radius-bl',
  ]);
  const parts: string[] = [];
  for (const [key, value] of Object.entries(vars)) {
    if (!value || skip.has(key)) continue;
    const prop = key.replace(/^--/, '');
    if (prop === 'font-size') parts.push(`font-size:${value}`);
    else if (prop === 'font-weight') parts.push(`font-weight:${value}`);
    else if (prop === 'font-family') parts.push(`font-family:${value}`);
    else if (prop === 'text-align') parts.push(`text-align:${value}`);
    else if (prop === 'color') parts.push(`color:${value}`);
    else if (prop === 'opacity') {
      const n = Number(value);
      parts.push(`opacity:${n > 1 ? n / 100 : n}`);
    } else if (prop === 'object-fit') parts.push(`object-fit:${value}`);
    else if (prop === 'line-height') parts.push(`line-height:${value}`);
  }

  const radius = resolveBorderRadius(vars);
  if (radius && radius !== '0px') parts.push(`border-radius:${radius}`);

  const fillBg = resolveFillBackground(vars);
  if (
    (vars['--fill-type'] === 'linear' || vars['--fill-type'] === 'radial') &&
    fillBg !== 'transparent'
  ) {
    parts.push(`background:${fillBg}`);
  } else if (fillBg !== 'transparent') {
    parts.push(`background-color:${fillBg}`);
  } else {
    parts.push('background-color:transparent');
  }

  const stroke = resolveStrokeStyle(vars);
  if (stroke.border) {
    parts.push(`border:${stroke.border}`);
  } else if (stroke.outline) {
    parts.push(`outline:${stroke.outline}`);
    if (stroke.outlineOffset) parts.push(`outline-offset:${stroke.outlineOffset}`);
  }

  const shadowParts: string[] = [];
  if (vars['--box-shadow'] && vars['--box-shadow'] !== 'none') {
    shadowParts.push(vars['--box-shadow']);
  }
  if (stroke.boxShadowExtra) shadowParts.push(stroke.boxShadowExtra);
  if (shadowParts.length) parts.push(`box-shadow:${shadowParts.join(',')}`);

  const filter = resolveFilter(vars);
  if (filter) parts.push(`filter:${filter}`);

  const transform = buildLayerTransform(vars);
  if (transform) parts.push(`transform:${transform}`);

  return parts;
}
