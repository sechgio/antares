/** Canvas types — Layer model inspired by shadcn/designer (reference only). */

export const DOCUMENT_VERSION = 2 as const;

export const A4_WIDTH_MM = 210;
export const A4_HEIGHT_MM = 297;

/** A4 at 96dpi for on-screen frame sizing. */
export const A4_WIDTH_PX = Math.round((A4_WIDTH_MM * 96) / 25.4);
export const A4_HEIGHT_PX = Math.round((A4_HEIGHT_MM * 96) / 25.4);

export type GridRule = { whenImages: number; cols: number; rows: number };

export type CanvasLayerType =
  | 'text'
  | 'image'
  | 'frame'
  | 'field'
  | 'logo'
  | 'imageSlot'
  | 'rect'
  | 'grid'
  | 'group'
  | 'table'
  | 'checkbox'
  | 'signature'
  | 'line'
  | 'ellipse'
  | 'arrow'
  | 'polygon'
  | 'star';

export interface LayerCssVars {
  '--width': string;
  '--height': string;
  '--translate-x': string;
  '--translate-y': string;
  '--background-color'?: string;
  '--color'?: string;
  '--font-size'?: string;
  '--font-weight'?: string;
  '--font-family'?: string;
  '--text-align'?: string;
  '--opacity'?: string;
  '--border'?: string;
  '--border-width'?: string;
  '--border-color'?: string;
  '--border-radius'?: string;
  '--rotate'?: string;
  '--object-fit'?: string;
  /** Flip horizontal: "1" | "-1" */
  '--scale-x'?: string;
  /** Flip vertical: "1" | "-1" */
  '--scale-y'?: string;
  /** Fill opacity 0–100 */
  '--fill-opacity'?: string;
  /** "0" hides fill */
  '--fill-visible'?: string;
  /** Stroke opacity 0–100 */
  '--stroke-opacity'?: string;
  /** "0" hides stroke */
  '--stroke-visible'?: string;
  /** inside | center | outside */
  '--stroke-align'?: string;
  /** CSS box-shadow or "none" */
  '--box-shadow'?: string;
  /** "1" locks W/H aspect ratio in inspector */
  '--aspect-locked'?: string;
  [key: string]: string | undefined;
}

export type CanvasTool =
  | 'select'
  | 'hand'
  | 'text'
  | 'field'
  | 'rect'
  | 'logo'
  | 'imageSlot'
  | 'image'
  | 'grid'
  | 'table'
  | 'checkbox'
  | 'signature'
  | 'line'
  | 'ellipse'
  | 'arrow'
  | 'polygon'
  | 'star';

export type CanvasMode = 'design' | 'generate';

export interface LayerMeta {
  key?: string;
  fallback?: string;
  side?: 'left' | 'right';
  index?: number;
  cols?: number;
  rows?: number;
  gapMm?: number;
  rules?: GridRule[];
  showDate?: boolean;
  showCoords?: boolean;
  showFilename?: boolean;
  checked?: boolean;
  rowsData?: string;
  imagesPerPage?: number;
  pageIndex?: number;
}

export interface CanvasLayer {
  id: string;
  type: CanvasLayerType;
  name: string;
  value: string;
  locked?: boolean;
  parentId?: string;
  visible?: boolean;
  pageIndex?: number;
  cssVars: LayerCssVars;
  meta?: LayerMeta;
}

export interface CanvasFieldDef {
  id: string;
  key: string;
  label: string;
}

export interface CanvasDocument {
  version: 1 | typeof DOCUMENT_VERSION;
  id: string;
  name: string;
  page: { widthMm: number; heightMm: number };
  layers: CanvasLayer[];
  fields: CanvasFieldDef[];
  pages?: Array<{ id: string; name: string }>;
  settings?: { imagesPerPage?: number; gridRules?: GridRule[] };
}

export interface CanvasDocumentSummary {
  id: string;
  name: string;
}

export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/** Upgrade v1 documents to the current schema. */
export function normalizeDocument(doc: CanvasDocument): CanvasDocument {
  if (doc.version === DOCUMENT_VERSION) return doc;
  const pageId = newId();
  return {
    ...doc,
    version: DOCUMENT_VERSION,
    pages: doc.pages ?? [{ id: pageId, name: 'Página 1' }],
    layers: doc.layers.map((layer) => ({
      ...layer,
      pageIndex: layer.pageIndex ?? 0,
    })),
    settings: doc.settings ?? {},
  };
}

export function createEmptyDocument(name = 'Sin título'): CanvasDocument {
  const pageId = newId();
  return {
    version: DOCUMENT_VERSION,
    id: newId(),
    name,
    page: { widthMm: A4_WIDTH_MM, heightMm: A4_HEIGHT_MM },
    pages: [{ id: pageId, name: 'Página 1' }],
    settings: {},
    layers: [
      {
        id: newId(),
        type: 'frame',
        name: 'Página A4',
        value: '',
        locked: true,
        pageIndex: 0,
        cssVars: {
          '--width': `${A4_WIDTH_MM}mm`,
          '--height': `${A4_HEIGHT_MM}mm`,
          '--translate-x': '0mm',
          '--translate-y': '0mm',
          '--background-color': '#ffffff',
        },
      },
    ],
    fields: [],
  };
}

export function parseMm(value: string | undefined, fallback = 0): number {
  if (!value) return fallback;
  const match = String(value).trim().match(/^(-?[\d.]+)\s*mm$/i);
  if (match) return Number(match[1]);
  const px = String(value).trim().match(/^(-?[\d.]+)\s*px$/i);
  if (px) return (Number(px[1]) * 25.4) / 96;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function mm(n: number): string {
  return `${Math.round(n * 100) / 100}mm`;
}
