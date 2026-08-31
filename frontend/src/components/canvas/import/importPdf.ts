import { ensurePdfJs } from '../../../lib/pdfjs';
import type { CanvasDocument } from '../types';
import { registerImageBlob } from '../utils/imageBlobStore';
import {
  assertPdfFileSize,
  normalizePdfPageRange,
  type PdfImportLimits,
  resolvePdfImportLimits,
} from './pdfImportLimits';
import { extractPdfDocument, throwIfAborted } from './pdfExtract';
import { persistPdfImage } from './pdfImageAssets';
import { mapPdfPagesToCanvas } from './pdfToCanvas';
import { canvasManifestToFragment, parseCanvasManifest } from './pdfManifest';
import type {
  PdfCanvasFragment,
  PdfDocumentExtraction,
  PdfImportOptions,
  PdfImportPreflight,
  PdfImportProgress,
  PdfImportResult,
  PdfPageExtraction,
  PdfPrimitive,
} from './pdfImportTypes';

function progress(
  options: PdfImportOptions,
  value: PdfImportProgress,
): void {
  options.onProgress?.(value);
}

function withUnsupportedImage(
  primitive: PdfPrimitive,
): Extract<PdfPrimitive, { kind: 'unsupported' }> {
  if (primitive.kind !== 'image') {
    throw new Error('Expected image primitive');
  }
  return {
    kind: 'unsupported',
    box: primitive.box,
    reason: 'unsupported-operator',
    sourceOpCount: 1,
  };
}

function selectManifestPages(
  document: CanvasDocument,
  pageStart: number,
  pageEnd: number,
): CanvasDocument {
  const pages = document.pages || [{ id: 'page-1', name: 'Página 1' }];
  const start = Math.max(0, pageStart - 1);
  const end = Math.min(pages.length - 1, pageEnd - 1);
  if (start === 0 && end === pages.length - 1) return document;
  const selected = new Set<number>();
  for (let index = start; index <= end; index += 1) selected.add(index);
  return {
    ...document,
    pages: pages.slice(start, end + 1),
    layers: document.layers
      .filter((layer) => selected.has(layer.pageIndex ?? 0))
      .map((layer) => ({ ...layer, pageIndex: (layer.pageIndex ?? 0) - start })),
    guides: document.guides
      ?.filter((guide) => selected.has(guide.pageIndex ?? 0))
      .map((guide) => ({ ...guide, pageIndex: (guide.pageIndex ?? 0) - start })),
  };
}

async function hydrateManifestAssets(
  document: CanvasDocument,
  limits: PdfImportLimits,
): Promise<CanvasDocument | null> {
  const imageLayers = document.layers.filter((layer) => layer.type === 'image' || layer.type === 'logo');
  if (imageLayers.some((layer) => !layer.value.trim())) return null;
  const refs = [...new Set(
    imageLayers
      .map((layer) => layer.value)
      .filter((value) => value.startsWith('canvas-asset:')),
  )];
  if (!refs.length) return document;
  const getAsset = window.electronAPI?.canvasAssetGet;
  if (!getAsset) return null;
  const chunks = new Map<string, ArrayBuffer>();
  let imageBytes = 0;
  for (const ref of refs) {
    try {
      const asset = await getAsset(ref);
      if (!asset?.chunk || !Number.isFinite(asset.chunk.byteLength)) return null;
      const declaredBytes = Number.isFinite(asset.bytes) ? asset.bytes : 0;
      imageBytes += Math.max(asset.chunk.byteLength, declaredBytes);
      if (imageBytes > limits.maxImageBytesTotal) return null;
      chunks.set(ref, asset.chunk);
    } catch {
      return null;
    }
  }
  const hydratedLayers = [];
  const hydratedValues = new Map<string, string>();
  for (const layer of document.layers) {
    if ((layer.type !== 'image' && layer.type !== 'logo') || !layer.value.startsWith('canvas-asset:')) {
      hydratedLayers.push(layer);
      continue;
    }
    const cached = hydratedValues.get(layer.value);
    if (cached) {
      hydratedLayers.push({ ...layer, value: cached });
      continue;
    }
    const chunk = chunks.get(layer.value);
    if (!chunk) return null;
    try {
      const registered = await registerImageBlob(new Blob([chunk]));
      hydratedValues.set(layer.value, registered.url);
      hydratedLayers.push({ ...layer, value: registered.url });
    } catch {
      return null;
    }
  }
  return { ...document, layers: hydratedLayers };
}

export async function mapPdfPagesToCanvasWithAssets(
  pages: PdfPageExtraction[],
  options: PdfImportOptions = {},
): Promise<PdfCanvasFragment> {
  const limits = resolvePdfImportLimits(options.limits);
  const assetValues = new Map<string, string>();
  let imageBytes = 0;
  const totalPages = pages.length;
  const pagesWithAssetFailures = pages.map((page) => ({ ...page, primitives: [...page.primitives], warnings: [...page.warnings], issues: [...(page.issues || [])] }));

  for (let pageIndex = 0; pageIndex < pagesWithAssetFailures.length; pageIndex += 1) {
    throwIfAborted(options.signal);
    const page = pagesWithAssetFailures[pageIndex]!;
    for (let primitiveIndex = 0; primitiveIndex < page.primitives.length; primitiveIndex += 1) {
      throwIfAborted(options.signal);
      const primitive = page.primitives[primitiveIndex]!;
      if (primitive.kind !== 'image') continue;
      if (assetValues.has(primitive.asset.key)) continue;
      if (imageBytes + primitive.asset.bytes.byteLength > limits.maxImageBytesTotal) {
        page.primitives[primitiveIndex] = withUnsupportedImage(primitive);
        page.warnings.push(`Página ${page.pageNumber}: imagen omitida por límite de bytes`);
        page.issues!.push({
          pageNumber: page.pageNumber,
          reason: 'limit-exceeded',
          message: 'La imagen supera el presupuesto agregado de imágenes',
          count: 1,
        });
        continue;
      }
      imageBytes += primitive.asset.bytes.byteLength;
      try {
        const liveValue = await persistPdfImage(primitive.asset);
        // Keep the ObjectURL for immediate painting; the normal Canvas save
        // lifecycle serializes the same bytes to the asset reference.
        assetValues.set(primitive.asset.key, liveValue);
      } catch {
        page.primitives[primitiveIndex] = withUnsupportedImage(primitive);
        page.warnings.push(`Página ${page.pageNumber}: imagen no persistida`);
        page.issues!.push({
          pageNumber: page.pageNumber,
          reason: 'unsupported-operator',
          message: 'La imagen PDF no pudo persistirse como asset',
          count: 1,
        });
      }
    }
    progress(options, {
      stage: 'persisting',
      page: pageIndex + 1,
      totalPages,
      layers: 0,
      skipped: page.issues?.reduce((sum, issue) => sum + issue.count, 0) || 0,
    });
  }

  return mapPdfPagesToCanvas(pagesWithAssetFailures, {
    limits,
    mixedPagePolicy: options.mixedPagePolicy,
    assetValues,
  });
}

export async function inspectPdfFile(file: File): Promise<PdfImportPreflight> {
  const limits = resolvePdfImportLimits();
  assertPdfFileSize(file.size, limits);
  if (file.type && file.type !== 'application/pdf') throw new Error('Selecciona un archivo PDF');
  const bytes = new Uint8Array(await file.arrayBuffer());
  throwIfAborted(undefined);
  const pdfjs = await ensurePdfJs();
  const loadingTask = pdfjs.getDocument({ data: bytes, stopAtErrors: true });
  const pdf = await loadingTask.promise;
  try {
    const pageSizes: PdfImportPreflight['pageSizes'] = [];
    const inspectedPageCount = Math.min(pdf.numPages, limits.maxPages);
    for (let pageNumber = 1; pageNumber <= inspectedPageCount; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      try {
        const viewport = page.getViewport({ scale: 1 });
        pageSizes.push({ widthPt: viewport.width, heightPt: viewport.height });
      } finally {
        page.cleanup();
      }
    }
    const first = pageSizes[0];
    const hasMixedPageSizes = Boolean(first && pageSizes.some((size) => Math.abs(size.widthPt - first.widthPt) > 0.01 || Math.abs(size.heightPt - first.heightPt) > 0.01));
    return { pageCount: pdf.numPages, pageSizes, hasMixedPageSizes };
  } finally {
    await pdf.cleanup();
    await pdf.destroy();
  }
}

export async function importPdfFile(
  file: File,
  options: PdfImportOptions = {},
): Promise<PdfImportResult> {
  const limits = resolvePdfImportLimits(options.limits);
  assertPdfFileSize(file.size, limits);
  if (file.type && file.type !== 'application/pdf') throw new Error('Selecciona un archivo PDF');
  progress(options, { stage: 'loading', page: 0, totalPages: 0, layers: 0, skipped: 0 });
  const bytes = new Uint8Array(await file.arrayBuffer());
  throwIfAborted(options.signal);
  let manifestChecked = false;
  const manifestState: { document: CanvasDocument | null } = { document: null };
  let manifestFallbackWarning = false;
  const acceptManifest = async (manifestBytes: Uint8Array): Promise<boolean> => {
    manifestChecked = true;
    const parsed = parseCanvasManifest(manifestBytes, limits);
    const hydrated = parsed ? await hydrateManifestAssets(parsed, limits) : null;
    if (hydrated) {
      manifestState.document = hydrated;
      return true;
    }
    manifestFallbackWarning = true;
    return false;
  };
  const extraction: PdfDocumentExtraction = await extractPdfDocument(bytes, {
    ...options,
    limits,
    onManifest: acceptManifest,
  });
  throwIfAborted(options.signal);

  // Keep compatibility with mocked/custom extractors that return the attachment
  // without invoking the early-exit hook.
  if (!manifestChecked && extraction.manifestBytes) {
    await acceptManifest(extraction.manifestBytes);
  }
  const manifestDocument = manifestState.document;
  if (manifestDocument) {
    const pageCount = manifestDocument.pages?.length || extraction.pages.length || 1;
    const { first, last } = normalizePdfPageRange(pageCount, options.pageStart, options.pageEnd);
    const selectedManifest = selectManifestPages(manifestDocument, first, last);
    const fragment = canvasManifestToFragment(selectedManifest);
    progress(options, {
      stage: 'mapping',
      page: selectedManifest.pages?.length || extraction.pages.length,
      totalPages: selectedManifest.pages?.length || extraction.pages.length,
      layers: fragment.importedLayerIds.length,
      skipped: fragment.report.skippedCount,
    });
    return { fragment, report: fragment.report, sourceName: file.name };
  }
  const fragment = await mapPdfPagesToCanvasWithAssets(extraction.pages, { ...options, limits });
  throwIfAborted(options.signal);
  const finalFragment = manifestFallbackWarning
    ? {
        ...fragment,
        report: {
          ...fragment.report,
          warnings: [...fragment.report.warnings, 'El manifiesto Canvas no pudo usarse; se aplicó importación heurística'],
        },
      }
    : fragment;
  progress(options, {
    stage: 'mapping',
    page: extraction.pages.length,
    totalPages: extraction.pages.length,
    layers: finalFragment.importedLayerIds.length,
    skipped: finalFragment.report.skippedCount,
  });
  return { fragment: finalFragment, report: finalFragment.report, sourceName: file.name };
}
