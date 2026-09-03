
import schema from '../../../../shared/canvas-schema.json';

export const DOCUMENT_VERSION = schema.documentVersion as unknown as 2;

export const A4_WIDTH_MM = schema.a4.widthMm as number;
export const A4_HEIGHT_MM = schema.a4.heightMm as number;

export const DEFAULT_PAGE_MARGIN_MM = 10;

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
  '--font-style'?: string;
  '--text-decoration'?: string;
  '--letter-spacing'?: string;
  '--text-transform'?: string;
  '--text-valign'?: string;
  '--opacity'?: string;
  '--border'?: string;
  '--border-width'?: string;
  '--border-color'?: string;
  '--border-radius'?: string;
  '--radius-tl'?: string;
  '--radius-tr'?: string;
  '--radius-br'?: string;
  '--radius-bl'?: string;
  '--rotate'?: string;
  '--object-fit'?: string;
  '--scale-x'?: string;
  '--scale-y'?: string;
  '--fill-opacity'?: string;
  '--fill-visible'?: string;
  '--fill-type'?: string;
  '--fill-color-2'?: string;
  '--fill-angle'?: string;
  '--filter-blur'?: string;
  '--image-zoom'?: string;
  '--object-position'?: string;
  '--stroke-dash'?: string;
  '--stroke-opacity'?: string;
  '--stroke-visible'?: string;
  '--stroke-align'?: string;
  '--box-shadow'?: string;
  '--aspect-locked'?: string;
  '--stroke-start'?: string;
  '--stroke-end'?: string;
  '--blend-mode'?: string;
  '--resize-anchor'?: string;
  [key: string]: string | undefined;
}

export type StrokeCap = 'none' | 'round' | 'square' | 'arrow';

export type PathPoint = {
  x: number;
  y: number;
  hin?: { x: number; y: number } | null;
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
  colTracks?: number[];
  rowTracks?: number[];
  rules?: GridRule[];
  showDate?: boolean;
  showCoords?: boolean;
  showFilename?: boolean;
  checked?: boolean;
  rowsData?: string;
  imagesPerPage?: number;
  pageIndex?: number;
  path?: LayerPath;
  autoLayout?: LayerAutoLayout;
  constraintH?: FrameConstraint;
  constraintV?: FrameConstraint;
  instanceOf?: string;
  overrideVars?: Partial<LayerCssVars>;
  variant?: string;
  componentId?: string;
  variants?: Record<string, Partial<LayerCssVars>>;
  maskLayerId?: string;
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
  fillStyleId?: string;
  textStyleId?: string;
  effectStyleId?: string;
}

export interface CanvasFieldDef {
  id: string;
  key: string;
  label: string;
}

export interface CanvasGuide {
  id: string;
  axis: 'x' | 'y';
  posMm: number;
  pageIndex?: number;
}

export type CanvasStyleKind = 'color' | 'text' | 'effect';

export interface CanvasSharedStyle {
  id: string;
  name: string;
  kind: CanvasStyleKind;
  cssVars: Partial<LayerCssVars>;
}

export interface CanvasDocument {
  version: 1 | typeof DOCUMENT_VERSION;
  id: string;
  name: string;
  updatedAt?: string;
  page: { widthMm: number; heightMm: number };
  layers: CanvasLayer[];
  fields: CanvasFieldDef[];
  pages?: Array<{ id: string; name: string }>;
  settings?: {
    imagesPerPage?: number;
    gridRules?: GridRule[];
    showRulers?: boolean;
    snapToGrid?: boolean;
    gridSizeMm?: number;
    pageMarginMm?: number;
  };
  guides?: CanvasGuide[];
  styles?: CanvasSharedStyle[];
}

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

function pageCountFromDoc(doc: CanvasDocument): number {
  if (doc.pages?.length) return doc.pages.length;
  const indices = doc.layers.map((l) => l.pageIndex ?? 0);
  return indices.length ? Math.max(...indices) + 1 : 1;
}

export function normalizeDocument(doc: CanvasDocument): CanvasDocument {
  const needsUpgrade = doc.version !== DOCUMENT_VERSION;
  const needsRepair =
    !doc.pages?.length ||
    doc.settings == null ||
    doc.guides == null ||
    doc.styles == null ||
    doc.layers.some((layer) => layer.pageIndex == null);

  if (!needsUpgrade && !needsRepair) {
    const lastPage = Math.max(0, (doc.pages?.length ?? 1) - 1);
    const clampNeeded = doc.layers.some(
      (layer) => (layer.pageIndex ?? 0) > lastPage || (layer.pageIndex ?? 0) < 0,
    );
    if (!clampNeeded) {
      return {
        ...doc,
        styles: doc.styles ?? [],
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

  const lastPage = Math.max(0, (upgraded.pages?.length ?? 1) - 1);
  let layers = upgraded.layers.map((layer) => {
    const raw = layer.pageIndex ?? 0;
    const clamped = Math.min(Math.max(0, raw), lastPage);
    return clamped === layer.pageIndex ? layer : { ...layer, pageIndex: clamped };
  });

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
