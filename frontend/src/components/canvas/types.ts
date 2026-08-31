/** Canvas types — Layer model inspired by shadcn/designer (reference only). */

import schema from '../../../../shared/canvas-schema.json';

export const DOCUMENT_VERSION = schema.documentVersion as unknown as 2;

export const A4_WIDTH_MM = schema.a4.widthMm as number;
export const A4_HEIGHT_MM = schema.a4.heightMm as number;

/** Default print safe-area inset when `settings.pageMarginMm` is unset. */
export const DEFAULT_PAGE_MARGIN_MM = 10;

/** A4 at 96dpi for on-screen frame sizing. */
export const A4_WIDTH_PX = Math.round((A4_WIDTH_MM * 96) / 25.4);
export const A4_HEIGHT_PX = Math.round((A4_HEIGHT_MM * 96) / 25.4);

export type GridRule = { whenImages: number; cols: number; rows: number };

export type CanvasLayerType =
  | 'text'
  | 'image'
  | 'frame'
  | 'component'
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
  | 'pentagon'
  | 'boolean';

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
  /** Italic: "italic" | "" */
  '--font-style'?: string;
  /** Underline / strikethrough: "underline" | "line-through" | "" */
  '--text-decoration'?: string;
  /** CSS letter-spacing, e.g. "0.5px" or "-0.2px" */
  '--letter-spacing'?: string;
  /** none | uppercase | lowercase | capitalize */
  '--text-transform'?: string;
  /** Vertical alignment inside the layer box: flex-start | center | flex-end */
  '--text-valign'?: string;
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

export type AutoLayoutDirection = 'row' | 'col';
export type AutoLayoutAlign = 'start' | 'center' | 'end' | 'stretch';
export type AutoLayoutSizing = 'hug' | 'fixed';
export type FrameConstraint = 'start' | 'end' | 'center' | 'scale';

export interface LayerAutoLayout {
  direction: AutoLayoutDirection;
  gapMm: number;
  padMm: number;
  alignMain: AutoLayoutAlign;
  alignCross: AutoLayoutAlign;
  sizing: AutoLayoutSizing;
}

export interface LayerMeta {
  key?: string;
  fallback?: string;
  side?: 'left' | 'right';
  index?: number;
  cols?: number;
  rows?: number;
  gapMm?: number;
  /** Relative column widths (length = cols). Unequal values keep free cell sizing. */
  colTracks?: number[];
  /** Relative row heights (length = rows). */
  rowTracks?: number[];
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
  /** Auto-layout stack on frame/group containers (positions children via cssVars). */
  autoLayout?: LayerAutoLayout;
  /** Horizontal constraint relative to parent container. */
  constraintH?: FrameConstraint;
  /** Vertical constraint relative to parent container. */
  constraintV?: FrameConstraint;
  /** Id of the master component this layer instances (instances only). */
  instanceOf?: string;
  /** Subset of cssVars this instance overrides; wins over master (+ variant). */
  overrideVars?: Partial<LayerCssVars>;
  /** Variant key on the master (e.g. 'primary'). */
  variant?: string;
  /** Present only on the master; equals the master's own layer id. */
  componentId?: string;
  /** Named variant patches on the master (partial cssVars per key). */
  variants?: Record<string, Partial<LayerCssVars>>;
  /** Id of the layer whose silhouette clips this layer (CSS clip-path composition). */
  maskLayerId?: string;
  /**
   * Boolean operands for type:'boolean' layers.
   * Visual CSS composition only — not an exact geometric boolean solver.
   */
  ops?: Array<{ op: 'union' | 'subtract' | 'intersect' | 'exclude'; layerId: string }>;
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
  /** Linked shared color/fill/stroke style (document.styles kind=color). */
  fillStyleId?: string;
  /** Linked shared text style (document.styles kind=text). */
  textStyleId?: string;
  /** Linked shared effect style (document.styles kind=effect). */
  effectStyleId?: string;
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

export type CanvasStyleKind = 'color' | 'text' | 'effect';

/** Named reusable style patch stored on the document (Figma-like shared styles). */
export interface CanvasSharedStyle {
  id: string;
  name: string;
  kind: CanvasStyleKind;
  /** Subset of LayerCssVars for this kind only. */
  cssVars: Partial<LayerCssVars>;
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
    /** Print safe-area inset in mm (default 10). 0 hides overlay and margin snap. */
    pageMarginMm?: number;
  };
  /** Manual guides dragged from rulers. */
  guides?: CanvasGuide[];
  /** Shared color / text / effect styles (optional; absent = legacy docs). */
  styles?: CanvasSharedStyle[];
}

/** Resolve page margin: unset → default; explicit 0 disables margins. */
export function resolvePageMarginMm(settings?: CanvasDocument['settings']): number {
  if (settings?.pageMarginMm === undefined) return DEFAULT_PAGE_MARGIN_MM;
  const n = settings.pageMarginMm;
  if (!Number.isFinite(n) || n < 0) return DEFAULT_PAGE_MARGIN_MM;
  return n;
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

/** Mirror of ops/pages.ts getPageCount — kept local to avoid import cycles. */
function pageCountFromDoc(doc: CanvasDocument): number {
  if (doc.pages?.length) return doc.pages.length;
  const indices = doc.layers.map((l) => l.pageIndex ?? 0);
  return indices.length ? Math.max(...indices) + 1 : 1;
}

/** Upgrade v1 / repair incomplete v2 documents to the current schema. */
export function normalizeDocument(doc: CanvasDocument): CanvasDocument {
  const needsUpgrade = doc.version !== DOCUMENT_VERSION;
  const needsRepair =
    !doc.pages?.length ||
    doc.settings == null ||
    doc.guides == null ||
    doc.styles == null ||
    doc.layers.some((layer) => layer.pageIndex == null);

  // Fast-path: current version, complete structure, and valid pageIndex range.
  // Avoids walking every layer on every open for already-normalized documents.
  if (!needsUpgrade && !needsRepair) {
    const lastPage = Math.max(0, (doc.pages?.length ?? 1) - 1);
    const clampNeeded = doc.layers.some(
      (layer) => (layer.pageIndex ?? 0) > lastPage || (layer.pageIndex ?? 0) < 0,
    );
    if (!clampNeeded) {
      return {
        ...doc,
        styles: doc.styles ?? [],
        // Missing timestamps must not sort as epoch (would always lose LWW).
        updatedAt: doc.updatedAt || new Date().toISOString(),
      };
    }
  }

  const upgraded =
    !needsUpgrade && !needsRepair
      ? doc
      : {
          ...doc,
          version: DOCUMENT_VERSION as typeof DOCUMENT_VERSION,
          // Legacy docs without `pages`: synthesize from max pageIndex so
          // multipage layouts are not collapsed onto page 0 (ops/pages.ts:6-10).
          pages: doc.pages?.length
            ? doc.pages
            : Array.from({ length: pageCountFromDoc(doc) }, (_, i) => ({
                id: newId(),
                name: `Página ${i + 1}`,
              })),
          layers: doc.layers.map((layer) => ({
            ...layer,
            pageIndex: layer.pageIndex ?? 0,
          })),
          settings: doc.settings ?? {},
          guides: doc.guides ?? [],
          styles: doc.styles ?? [],
        };

  // Match backend normalize_document: clamp pageIndex into the valid page range.
  const lastPage = Math.max(0, (upgraded.pages?.length ?? 1) - 1);
  let layers = upgraded.layers.map((layer) => {
    const raw = layer.pageIndex ?? 0;
    const clamped = Math.min(Math.max(0, raw), lastPage);
    return clamped === layer.pageIndex ? layer : { ...layer, pageIndex: clamped };
  });

  // Prune dangling parentId references and self-cycles
  const validIds = new Set(layers.map((l) => l.id));
  layers = layers.map((layer) => {
    if (layer.parentId && (!validIds.has(layer.parentId) || layer.parentId === layer.id)) {
      return { ...layer, parentId: undefined };
    }
    return layer;
  });

  return {
    ...upgraded,
    layers,
    styles: upgraded.styles ?? [],
    // Missing timestamps must not sort as epoch (would always lose LWW).
    updatedAt: upgraded.updatedAt || new Date().toISOString(),
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
    styles: [],
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
