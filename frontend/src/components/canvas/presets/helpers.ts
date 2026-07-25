/**
 * Shared builders for canvas presets.
 * Visual reference: backend/templates/*.html (read-only — never imported at runtime).
 */
import { applyGridToImageSlots, DEFAULT_GRID_RULES } from '../ops/gridLayout';
import type { CanvasDocument, CanvasLayer } from '../types';
import { DOCUMENT_VERSION, mm, newId } from '../types';

export function baseFrame(): CanvasLayer {
  return {
    id: newId(),
    type: 'frame',
    name: 'Página A4',
    value: '',
    locked: true,
    pageIndex: 0,
    cssVars: {
      '--width': mm(210),
      '--height': mm(297),
      '--translate-x': mm(0),
      '--translate-y': mm(0),
      '--background-color': '#ffffff',
    },
  };
}

export function logoSlot(opts: {
  side: 'left' | 'right' | 'center';
  x: number;
  y: number;
  w: number;
  h: number;
  name?: string;
}): CanvasLayer {
  return {
    id: newId(),
    type: 'logo',
    name: opts.name ?? (opts.side === 'left' ? 'Logo izquierdo' : opts.side === 'right' ? 'Logo derecho' : 'Logo'),
    value: '',
    pageIndex: 0,
    cssVars: {
      '--width': mm(opts.w),
      '--height': mm(opts.h),
      '--translate-x': mm(opts.x),
      '--translate-y': mm(opts.y),
      '--background-color': '#f8fafc',
      '--border-width': '1px',
      '--border-color': '#999999',
      '--object-fit': 'contain',
    },
    meta: { side: opts.side === 'center' ? 'left' : opts.side },
  };
}

/** Dual logos matching report/emergencias header (55×18 mm @ 8 mm pad). */
export function dualLogos(pad = 8, w = 55, h = 18): CanvasLayer[] {
  return [
    logoSlot({ side: 'left', x: pad, y: pad, w, h }),
    logoSlot({ side: 'right', x: 210 - pad - w, y: pad, w, h }),
  ];
}

export function textLayer(opts: {
  name: string;
  value: string;
  x: number;
  y: number;
  w: number;
  h?: number;
  fontSize?: string;
  fontWeight?: string;
  color?: string;
  align?: string;
  bg?: string;
}): CanvasLayer {
  return {
    id: newId(),
    type: 'text',
    name: opts.name,
    value: opts.value,
    pageIndex: 0,
    cssVars: {
      '--width': mm(opts.w),
      '--height': mm(opts.h ?? 8),
      '--translate-x': mm(opts.x),
      '--translate-y': mm(opts.y),
      '--color': opts.color ?? '#111111',
      '--font-size': opts.fontSize ?? '9pt',
      '--font-weight': opts.fontWeight ?? '400',
      '--text-align': opts.align ?? 'left',
      '--background-color': opts.bg ?? 'transparent',
    },
  };
}

export type FieldSpec = {
  key: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h?: number;
  fontSize?: string;
  dotted?: boolean;
};

export function fieldLayer(f: FieldSpec): CanvasLayer {
  const dotted = f.dotted ?? false;
  return {
    id: newId(),
    type: 'field',
    name: f.label,
    value: '',
    pageIndex: 0,
    cssVars: {
      '--width': mm(f.w),
      '--height': mm(f.h ?? 7),
      '--translate-x': mm(f.x),
      '--translate-y': mm(f.y),
      '--color': '#222222',
      '--font-size': f.fontSize ?? '7pt',
      '--background-color': dotted ? '#fefefe' : '#f8fafc',
      '--border-width': '1px',
      '--border-color': dotted ? '#888888' : '#e2e8f0',
      '--border-style': dotted ? 'dotted' : 'solid',
      '--text-align': 'left',
    },
    meta: { key: f.key, fallback: '-' },
  };
}

export function addFields(layers: CanvasLayer[], fields: FieldSpec[]): void {
  for (const f of fields) layers.push(fieldLayer(f));
}

export function addPhotoGrid(
  layers: CanvasLayer[],
  opts: {
    x: number;
    y: number;
    w: number;
    h: number;
    cols: number;
    rows: number;
    gapMm?: number;
    objectFit?: string;
    borderColor?: string;
    cellBg?: string;
    name?: string;
  },
): void {
  const gridId = newId();
  const border = opts.borderColor ?? '#0066cc';
  layers.push({
    id: gridId,
    type: 'grid',
    name: opts.name ?? 'Cuadrícula fotos',
    value: '',
    pageIndex: 0,
    cssVars: {
      '--width': mm(opts.w),
      '--height': mm(opts.h),
      '--translate-x': mm(opts.x),
      '--translate-y': mm(opts.y),
      '--background-color': 'transparent',
      '--border-width': '2px',
      '--border-color': border,
    },
    meta: {
      cols: opts.cols,
      rows: opts.rows,
      gapMm: opts.gapMm ?? 2,
      rules: DEFAULT_GRID_RULES,
    },
  });
  const count = opts.cols * opts.rows;
  for (let i = 0; i < count; i += 1) {
    layers.push({
      id: newId(),
      type: 'imageSlot',
      name: `Foto ${i + 1}`,
      value: '',
      pageIndex: 0,
      parentId: gridId,
      cssVars: {
        '--width': mm(40),
        '--height': mm(40),
        '--translate-x': mm(opts.x),
        '--translate-y': mm(opts.y),
        '--background-color': opts.cellBg ?? '#fafafa',
        '--border-width': '1px',
        '--border-color': '#e0e0e0',
        '--object-fit': opts.objectFit ?? 'cover',
      },
      meta: { index: i },
    });
  }
  const laid = applyGridToImageSlots(layers, gridId);
  layers.length = 0;
  layers.push(...laid);
}

export function headerRule(y: number, pad = 8, color = '#333333', weightPx = 2): CanvasLayer {
  return {
    id: newId(),
    type: 'line',
    name: 'Separador cabecera',
    value: '',
    pageIndex: 0,
    cssVars: {
      '--width': mm(210 - pad * 2),
      '--height': mm(0.5),
      '--translate-x': mm(pad),
      '--translate-y': mm(y),
      '--background-color': 'transparent',
      '--fill-visible': '0',
      '--border-width': `${weightPx}px`,
      '--border-color': color,
      '--stroke-align': 'center',
      '--stroke-visible': '1',
      '--stroke-opacity': '100',
    },
  };
}

export function docFrom(name: string, layers: CanvasLayer[], fieldKeys: string[]): CanvasDocument {
  const slotCount = layers.filter((l) => l.type === 'imageSlot').length;
  return {
    version: DOCUMENT_VERSION,
    id: newId(),
    name,
    page: { widthMm: 210, heightMm: 297 },
    pages: [{ id: newId(), name: 'Página 1' }],
    settings: slotCount > 0 ? { imagesPerPage: slotCount } : {},
    layers,
    fields: fieldKeys.map((key) => ({ id: newId(), key, label: key })),
  };
}

export function uniqueKeys(fields: FieldSpec[]): string[] {
  return [...new Set(fields.map((f) => f.key))];
}
