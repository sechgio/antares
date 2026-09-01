import {
  normalizeDocument,
  newId,
  type CanvasDocument,
  type CanvasLayer,
  type CanvasSharedStyle,
} from '../types';
import { resolvePdfImportLimits } from './pdfImportLimits';
import type { PdfImportLimits } from './pdfImportLimits';
import type { PdfCanvasFragment } from './pdfImportTypes';

const MANIFEST_SCHEMA = 'antares.canvas.pdf';
const MANIFEST_VERSION = 1;
const KNOWN_LAYER_TYPES = new Set([
  'text', 'image', 'frame', 'component', 'field', 'logo', 'imageSlot', 'rect',
  'grid', 'group', 'table', 'checkbox', 'signature', 'line', 'ellipse', 'arrow',
  'polygon', 'star', 'diamond', 'hexagon', 'pentagon', 'boolean',
]);

interface CanvasPdfManifest {
  schema: typeof MANIFEST_SCHEMA;
  version: typeof MANIFEST_VERSION;
  document: CanvasDocument;
  assets: Array<{ attachmentName: string; mimeType?: string; originalRef?: string }>;
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function cloneManifestDocument(document: CanvasDocument): CanvasDocument {
  const normalized = normalizeDocument(document);
  const clone = JSON.parse(JSON.stringify(normalized)) as CanvasDocument;
  delete clone.updatedAt;
  for (const layer of clone.layers) {
    if ((layer.type === 'image' || layer.type === 'logo') && layer.value.startsWith('data:')) {
      layer.value = '';
    }
    if ((layer.type === 'image' || layer.type === 'logo') && layer.value.startsWith('blob:')) {
      layer.value = '';
    }
  }
  return clone;
}

export async function serializeCanvasManifest(document: CanvasDocument): Promise<string> {
  const manifest: CanvasPdfManifest = {
    schema: MANIFEST_SCHEMA,
    version: MANIFEST_VERSION,
    document: cloneManifestDocument(document),
    assets: [],
  };
  const bytes = new TextEncoder().encode(JSON.stringify(manifest));
  const limits = resolvePdfImportLimits();
  if (bytes.byteLength > limits.maxManifestBytes) {
    throw new Error(`El manifiesto Canvas supera el límite de ${Math.round(limits.maxManifestBytes / 1024 / 1024)} MiB`);
  }
  return encodeBase64(bytes);
}

function validLayer(value: unknown): value is CanvasLayer {
  const layer = asRecord(value);
  return (
    typeof layer.id === 'string' &&
    typeof layer.type === 'string' &&
    KNOWN_LAYER_TYPES.has(layer.type) &&
    typeof layer.name === 'string' &&
    typeof layer.value === 'string' &&
    Boolean(layer.cssVars && typeof layer.cssVars === 'object' && !Array.isArray(layer.cssVars))
  );
}

function validField(value: unknown): value is CanvasDocument['fields'][number] {
  const field = asRecord(value);
  return typeof field.id === 'string' && typeof field.key === 'string' && typeof field.label === 'string';
}

function validPage(value: unknown): value is NonNullable<CanvasDocument['pages']>[number] {
  const page = asRecord(value);
  return typeof page.id === 'string' && typeof page.name === 'string';
}

function validStyle(value: unknown): value is CanvasSharedStyle {
  const style = asRecord(value);
  return (
    typeof style.id === 'string' &&
    typeof style.name === 'string' &&
    ['color', 'text', 'effect'].includes(style.kind as string) &&
    Boolean(style.cssVars && typeof style.cssVars === 'object' && !Array.isArray(style.cssVars))
  );
}

function validGuide(value: unknown): value is NonNullable<CanvasDocument['guides']>[number] {
  const guide = asRecord(value);
  return (
    typeof guide.id === 'string' &&
    (guide.axis === 'x' || guide.axis === 'y') &&
    typeof guide.posMm === 'number' &&
    Number.isFinite(guide.posMm)
  );
}

function validDocument(value: unknown): value is CanvasDocument {
  const document = asRecord(value);
  const page = asRecord(document.page);
  if (
    typeof document.id !== 'string' ||
    typeof document.name !== 'string' ||
    (document.version !== 1 && document.version !== 2) ||
    !Number.isFinite(page.widthMm) ||
    !Number.isFinite(page.heightMm) ||
    Number(page.widthMm) <= 0 ||
    Number(page.heightMm) <= 0 ||
    !Array.isArray(document.layers) ||
    !document.layers.every(validLayer) ||
    !Array.isArray(document.fields) ||
    !document.fields.every(validField)
  ) return false;
  if (document.pages !== undefined && (!Array.isArray(document.pages) || !document.pages.every(validPage))) return false;
  if (document.styles !== undefined && (!Array.isArray(document.styles) || !document.styles.every(validStyle))) return false;
  if (document.guides !== undefined && (!Array.isArray(document.guides) || !document.guides.every(validGuide))) return false;
  return true;
}

function withinImportLimits(document: CanvasDocument, limits: PdfImportLimits): boolean {
  if (document.layers.length > limits.maxLayersTotal) return false;
  const pageCount = document.pages?.length || 1;
  if (pageCount > limits.maxPages) return false;

  const layerCounts = new Map<number, number>();
  const imageCounts = new Map<number, number>();
  for (const layer of document.layers) {
    const rawPageIndex = layer.pageIndex;
    const pageIndex = typeof rawPageIndex === 'number' && Number.isFinite(rawPageIndex)
      ? Math.max(0, Math.floor(rawPageIndex))
      : 0;
    const layerCount = (layerCounts.get(pageIndex) || 0) + 1;
    if (layerCount > limits.maxLayersPerPage) return false;
    layerCounts.set(pageIndex, layerCount);
    if (layer.type === 'image' || layer.type === 'logo') {
      const imageCount = (imageCounts.get(pageIndex) || 0) + 1;
      if (imageCount > limits.maxImagesPerPage) return false;
      imageCounts.set(pageIndex, imageCount);
    }
  }
  return true;
}

export function parseCanvasManifest(
  bytes: Uint8Array,
  limits?: PdfImportLimits,
): CanvasDocument | null {
  const resolvedLimits = limits || resolvePdfImportLimits();
  if (bytes.byteLength === 0 || bytes.byteLength > resolvedLimits.maxManifestBytes) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
  const manifest = asRecord(parsed);
  if (manifest.schema !== MANIFEST_SCHEMA || manifest.version !== MANIFEST_VERSION) return null;
  if (!validDocument(manifest.document) || !withinImportLimits(manifest.document, resolvedLimits)) return null;
  try {
    return normalizeDocument(manifest.document);
  } catch {
    return null;
  }
}

function cloneLayerMeta(layer: CanvasLayer, idMap: Map<string, string>): CanvasLayer['meta'] {
  if (!layer.meta) return undefined;
  return {
    ...layer.meta,
    path: layer.meta.path
      ? {
          ...layer.meta.path,
          points: layer.meta.path.points.map((point) => ({
            ...point,
            hin: point.hin ? { ...point.hin } : point.hin,
            hout: point.hout ? { ...point.hout } : point.hout,
          })),
        }
      : undefined,
    instanceOf: layer.meta.instanceOf ? idMap.get(layer.meta.instanceOf) : undefined,
    maskLayerId: layer.meta.maskLayerId ? idMap.get(layer.meta.maskLayerId) : undefined,
    componentId: layer.meta.componentId ? idMap.get(layer.meta.componentId) : undefined,
    ops: layer.meta.ops?.map((operation) => ({
      ...operation,
      layerId: idMap.get(operation.layerId) || operation.layerId,
    })),
  };
}

export function canvasManifestToFragment(document: CanvasDocument): PdfCanvasFragment {
  const normalized = normalizeDocument(document);
  const pages = normalized.pages?.length
    ? normalized.pages
    : [{ id: newId(), name: 'Página 1' }];
  const idMap = new Map(normalized.layers.map((layer) => [layer.id, newId()]));
  const styleIdMap = new Map((normalized.styles || []).map((style) => [style.id, newId()]));
  const layers = normalized.layers.map((layer) => ({
    ...layer,
    id: idMap.get(layer.id)!,
    parentId: layer.parentId ? idMap.get(layer.parentId) : undefined,
    fillStyleId: layer.fillStyleId ? styleIdMap.get(layer.fillStyleId) : undefined,
    textStyleId: layer.textStyleId ? styleIdMap.get(layer.textStyleId) : undefined,
    effectStyleId: layer.effectStyleId ? styleIdMap.get(layer.effectStyleId) : undefined,
    cssVars: { ...layer.cssVars },
    meta: cloneLayerMeta(layer, idMap),
  }));
  const fields = normalized.fields.map((field) => ({ ...field, id: newId() }));
  const styles: CanvasSharedStyle[] = (normalized.styles || []).map((style) => ({
    ...style,
    id: styleIdMap.get(style.id)!,
    cssVars: { ...style.cssVars },
  }));
  const importedLayerIds = layers.filter((layer) => layer.type !== 'frame').map((layer) => layer.id);
  return {
    pages: pages.map((page) => ({ id: newId(), name: page.name })),
    layers,
    fields,
    styles,
    firstPageIndex: 0,
    importedLayerIds,
    report: {
      importedCount: importedLayerIds.length,
      skippedCount: 0,
      pagesProcessed: pages.length,
      issues: [],
      warnings: [],
    },
  };
}

export { decodeBase64 };
