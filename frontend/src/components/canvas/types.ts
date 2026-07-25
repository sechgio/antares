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
  | 'star'
  | 'diamond'
  | 'hexagon'
  | 'pentagon';

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
  /** Per-corner radii (px); fall back to --border-radius when unset */
  '--radius-tl'?: string;
  '--radius-tr'?: string;
  '--radius-br'?: string;
  '--radius-bl'?: string;
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
  /** solid | linear | radial */
  '--fill-type'?: string;
  /** Second stop for linear gradient */
  '--fill-color-2'?: string;
  /** Linear gradient angle in degrees */
  '--fill-angle'?: string;
  /** Layer blur in px (e.g. "4px") */
  '--filter-blur'?: string;
  /** Image zoom factor 1–3 for crop/pan */
  '--image-zoom'?: string;
  /** Image focal point, e.g. "50% 50%" */
  '--object-position'?: string;
  /** solid | dashed | dotted */
  '--stroke-dash'?: string;
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
  /** Line stroke start cap: none | round | square | arrow */
  '--stroke-start'?: string;
  /** Line stroke end cap: none | round | square | arrow */
  '--stroke-end'?: string;
  /** Layer compositing blend mode (CSS mix-blend-mode; default normal) */
  '--blend-mode'?: string;
  /** 9-point resize anchor (tl..br) pinning edges on inspector W/H edits */
  '--resize-anchor'?: string;
  [key: string]: string | undefined;
}

export type StrokeCap = 'none' | 'round' | 'square' | 'arrow';

export type PathPoint = {
  x: number;
  y: number;
  /** Incoming handle in layer-local mm; null/undefined = sharp corner */
  hin?: { x: number; y: number } | null;
  /** Outgoing handle in layer-local mm; null/undefined = sharp corner */
  hout?: { x: number; y: number } | null;
};

export type LayerPath = {
  points: PathPoint[];
  closed?: boolean;
};

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
  | 'star'
  | 'diamond'
  | 'hexagon'
  | 'pentagon'
  | 'lasso'
  | 'bend'
  | 'cut';

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
  /** Vector geometry for line layers (mm relative to layer origin). */
  path?: LayerPath;
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

/** Persistent alignment guide (page-relative mm). */
export interface CanvasGuide {
  id: string;
  axis: 'x' | 'y';
  posMm: number;
  pageIndex?: number;
}

export interface CanvasDocument {
  version: 1 | typeof DOCUMENT_VERSION;
  id: string;
  name: string;
  /** ISO-8601; used for local↔cloud last-write-wins sync. */
  updatedAt?: string;
  page: { widthMm: number; heightMm: number };
  layers: CanvasLayer[];
  fields: CanvasFieldDef[];
  pages?: Array<{ id: string; name: string }>;
  settings?: {
    imagesPerPage?: number;
    gridRules?: GridRule[];
    showRulers?: boolean;
    /** Snap layer edges to a regular mm grid while moving/resizing */
    snapToGrid?: boolean;
    /** Grid step in mm (default 5) */
    gridSizeMm?: number;
  };
  /** Manual guides dragged from rulers. */
  guides?: CanvasGuide[];
}

export interface CanvasDocumentSummary {
  id: string;
  name: string;
  updatedAt?: string;
}

export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/** Upgrade v1 documents to the current schema. */
export function normalizeDocument(doc: CanvasDocument): CanvasDocument {
  const upgraded =
    doc.version === DOCUMENT_VERSION
      ? doc
      : {
          ...doc,
          version: DOCUMENT_VERSION as typeof DOCUMENT_VERSION,
          pages: doc.pages ?? [{ id: newId(), name: 'Página 1' }],
          layers: doc.layers.map((layer) => ({
            ...layer,
            pageIndex: layer.pageIndex ?? 0,
          })),
          settings: doc.settings ?? {},
          guides: doc.guides ?? [],
        };
  return {
    ...upgraded,
    updatedAt: upgraded.updatedAt || new Date(0).toISOString(),
  };
}

export function createEmptyDocument(name = 'Sin título'): CanvasDocument {
  const pageId = newId();
  return {
    version: DOCUMENT_VERSION,
    id: newId(),
    name,
    updatedAt: new Date().toISOString(),
    page: { widthMm: A4_WIDTH_MM, heightMm: A4_HEIGHT_MM },
    pages: [{ id: pageId, name: 'Página 1' }],
    settings: {},
    guides: [],
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
