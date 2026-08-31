import type { CanvasDocument, CanvasLayer } from '../types';
import type { CanvasDiff, HistoryStep } from './canvasDiff';
import { isHistoryStepDiff } from './canvasDiff';

export interface RegisteredBlob {
  blobId: string;
  blob: Blob;
  url: string;
  thumbnailUrl: string;
  width: number;
  height: number;
  dataUrl?: string;
}

const blobMap = new Map<string, RegisteredBlob>();
const urlToBlobIdMap = new Map<string, string>();

/** True when a layer value may point at a managed ObjectURL / blobId. */
function isManagedImageValue(value: string | undefined): value is string {
  if (!value) return false;
  return value.startsWith('blob:') || value.startsWith('img_blob_') || blobMap.has(value);
}

/** Add a layer image value (and its paired blobId/url) to a live-ref set. */
export function trackImageRef(live: Set<string>, value: string | undefined): void {
  if (!value || !isManagedImageValue(value)) return;
  live.add(value);
  const reg = blobMap.get(value);
  if (reg) {
    live.add(reg.blobId);
    live.add(reg.url);
    return;
  }
  const blobId = urlToBlobIdMap.get(value);
  if (blobId) {
    live.add(blobId);
    const byUrl = blobMap.get(blobId);
    if (byUrl) live.add(byUrl.url);
  }
}

/** Collect managed image refs from image/logo layers. */
export function collectImageRefsFromLayers(layers: Iterable<CanvasLayer>): Set<string> {
  const live = new Set<string>();
  for (const layer of layers) {
    if (layer.type === 'image' || layer.type === 'logo') {
      trackImageRef(live, layer.value);
    }
  }
  return live;
}

function collectImageRefsFromDiff(diff: CanvasDiff, live: Set<string>): void {
  if (diff.addedLayers) {
    for (const layer of diff.addedLayers) {
      if (layer.type === 'image' || layer.type === 'logo') {
        trackImageRef(live, layer.value);
      }
    }
  }
  if (diff.modifiedLayers) {
    for (const patch of diff.modifiedLayers) {
      if (typeof patch.changes.value === 'string') {
        trackImageRef(live, patch.changes.value);
      }
    }
  }
}

/** Collect managed image refs retained by undo/redo history steps. */
export function collectImageRefsFromHistory(steps: Iterable<HistoryStep>): Set<string> {
  const live = new Set<string>();
  for (const step of steps) {
    if (isHistoryStepDiff(step)) {
      collectImageRefsFromDiff(step.undoDiff, live);
      collectImageRefsFromDiff(step.redoDiff, live);
    } else {
      for (const layer of step.layers) {
        if (layer.type === 'image' || layer.type === 'logo') {
          trackImageRef(live, layer.value);
        }
      }
    }
  }
  return live;
}

/** Helper to generate unique blob IDs */
function generateBlobId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `img_blob_${crypto.randomUUID()}`;
  }
  return `img_blob_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Registers an image Blob or File into the in-memory Blob Store.
 * Creates an ObjectURL. Large File uploads are downscaled in a Web Worker
 * (OffscreenCanvas) so decode/re-encode stays off the UI thread.
 */
export async function registerImageBlob(
  fileOrBlob: Blob | File,
  existingDataUrl?: string,
  opts?: { maxDimension?: number },
): Promise<RegisteredBlob> {
  let blob: Blob = fileOrBlob;
  let width = 0;
  let height = 0;

  // Downscale large stills off the UI thread when Worker/OffscreenCanvas exist.
  if (fileOrBlob instanceof File && fileOrBlob.type.startsWith('image/')) {
    try {
      const { processImageFileForCanvas } = await import('../workers/imageProcessorClient');
      const processed = await processImageFileForCanvas(fileOrBlob, opts?.maxDimension ?? 2048);
      blob = processed.blob;
      width = processed.width;
      height = processed.height;
    } catch {
      blob = fileOrBlob;
    }
  }

  const blobId = generateBlobId();
  const url = URL.createObjectURL(blob);

  const registered: RegisteredBlob = {
    blobId,
    blob,
    url,
    thumbnailUrl: url,
    width,
    height,
    dataUrl: existingDataUrl,
  };

  blobMap.set(blobId, registered);
  urlToBlobIdMap.set(url, blobId);

  return registered;
}

/**
 * Register an imported image for immediate Canvas rendering and persist the
 * same bytes when the Electron asset bridge is available. The live ObjectURL
 * is deliberately retained so an import never depends on an IPC round trip to
 * paint the newly-created layer.
 */
export async function registerAndPersistCanvasImage(
  blob: Blob,
): Promise<string> {
  const registered = await registerImageBlob(blob);
  const putAsset = window.electronAPI?.canvasAssetPut;
  if (!putAsset) return registered.url;
  try {
    await putAsset(await blob.arrayBuffer());
  } catch {
    // Keep the live URL. The asset GC will reclaim it if the import fails.
  }
  return registered.url;
}

/**
 * Retrieves the display ObjectURL for a given image value (blobId, blobUrl, dataUrl, etc.).
 */
export function getBlobUrl(value: string | undefined): string {
  if (!value) return '';
  if (value.startsWith('blob:') || value.startsWith('http://') || value.startsWith('https://')) {
    return value;
  }
  const reg = blobMap.get(value);
  if (reg) return reg.url;
  return value;
}

/**
 * Retrieves the thumbnail ObjectURL for a layer or value (defaults to 400px thumbnail if registered).
 */
export function getThumbnailUrl(value: string | undefined): string {
  if (!value) return '';
  const reg = blobMap.get(value);
  if (reg && reg.thumbnailUrl) return reg.thumbnailUrl;

  const blobId = urlToBlobIdMap.get(value);
  if (blobId) {
    const found = blobMap.get(blobId);
    if (found?.thumbnailUrl) return found.thumbnailUrl;
  }

  return getBlobUrl(value);
}

/**
 * Serializes an in-memory Blob to DataURL for disk / IPC persistence.
 */
export async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Prepares a document for saving to disk / IPC by converting in-memory ObjectURLs/blobIds
 * into canvas-asset refs (preferred) or DataURLs (fallback / cloud).
 */
export async function serializeDocumentImages(
  doc: CanvasDocument,
  options?: { preferAssetRefs?: boolean },
): Promise<CanvasDocument> {
  const preferAssetRefs = options?.preferAssetRefs !== false;
  const putAsset = window.electronAPI?.canvasAssetPut;

  const updatedLayers: CanvasLayer[] = await Promise.all(
    doc.layers.map(async (layer) => {
      if (layer.type === 'image' || layer.type === 'logo') {
        const val = layer.value;
        if (!val) return layer;
        if (val.startsWith('canvas-asset:')) return layer;

        let reg = blobMap.get(val);
        if (!reg && val.startsWith('blob:')) {
          const blobId = urlToBlobIdMap.get(val);
          if (blobId) reg = blobMap.get(blobId);
        }

        if (reg) {
          if (preferAssetRefs && putAsset) {
            try {
              const buf = await reg.blob.arrayBuffer();
              const stored = await putAsset(buf) as { ref: string };
              if (reg.dataUrl) delete reg.dataUrl;
              return { ...layer, value: stored.ref };
            } catch {
              // Fall through to DataURL persistence.
            }
          }
          const dataUrl = reg.dataUrl ?? (await blobToDataUrl(reg.blob));
          if (reg.dataUrl) delete reg.dataUrl;
          return { ...layer, value: dataUrl };
        }
      }
      return layer;
    })
  );

  return { ...doc, layers: updatedLayers };
}

/**
 * After a successful save, keep the editor's live image/logo values (blob:/blobId)
 * instead of swapping in persisted data: URLs. Avoids ~2× RAM (Blob + base64)
 * while Canvas keep-alive holds the store. Cloud/disk still get data URLs via
 * the serialized doc used for IPC / queueCanvasCloudPush.
 */
export function applySavedDocumentKeepingImages(
  editorDoc: CanvasDocument,
  savedDoc: CanvasDocument,
): CanvasDocument {
  const editorById = new Map(editorDoc.layers.map((l) => [l.id, l]));
  let changed = false;
  const layers = savedDoc.layers.map((layer) => {
    if (layer.type !== 'image' && layer.type !== 'logo') return layer;
    const prev = editorById.get(layer.id);
    if (!prev?.value || prev.value === layer.value) return layer;
    const keepLive =
      prev.value.startsWith('blob:') ||
      blobMap.has(prev.value) ||
      urlToBlobIdMap.has(prev.value);
    if (!keepLive) return layer;
    changed = true;
    return { ...layer, value: prev.value };
  });
  return changed ? { ...savedDoc, layers } : savedDoc;
}

/**
 * Expand `canvas-asset:` refs to data: URLs for cloud sync / backends that
 * cannot read the local asset store.
 *
 * @param strict When true, throw if any canvas-asset: ref remains unresolved.
 */
export async function embedCanvasAssetsAsDataUrls(
  doc: CanvasDocument,
  options?: { strict?: boolean },
): Promise<CanvasDocument> {
  const strict = options?.strict === true;
  const getAsset = window.electronAPI?.canvasAssetGet;
  if (!getAsset) {
    if (strict && countCanvasAssetRefs(doc) > 0) {
      throw new Error('No se pueden resolver canvas-asset: sin Electron (canvasAssetGet)');
    }
    return doc;
  }

  let changed = false;
  const layers: CanvasLayer[] = [];
  for (const layer of doc.layers) {
    if ((layer.type !== 'image' && layer.type !== 'logo') || !layer.value?.startsWith('canvas-asset:')) {
      layers.push(layer);
      continue;
    }
    try {
      const chunk = await readCanvasAssetChunk(getAsset, layer.value);
      const blob = new Blob([chunk]);
      const dataUrl = await blobToDataUrl(blob);
      changed = true;
      layers.push({ ...layer, value: dataUrl });
    } catch (err) {
      if (strict) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`No se pudo resolver ${layer.value}: ${msg}`);
      }
      layers.push(layer);
    }
  }
  const next = changed ? { ...doc, layers } : doc;
  if (strict && countCanvasAssetRefs(next) > 0) {
    throw new Error('Quedan referencias canvas-asset: sin resolver');
  }
  return next;
}

/** Count unresolved canvas-asset: refs on image/logo layers. */
export function countCanvasAssetRefs(doc: CanvasDocument): number {
  return canvasAssetRefs(doc).length;
}

function canvasAssetRefs(doc: CanvasDocument): string[] {
  return doc.layers.flatMap((layer) => (
    (layer.type === 'image' || layer.type === 'logo') && layer.value?.startsWith('canvas-asset:')
      ? [layer.value]
      : []
  ));
}

/**
 * Convert in-memory blob:/blobId layer values to data: URLs so a hidden
 * print BrowserWindow (no shared blob store) can still render images.
 */
export async function embedManagedBlobsAsDataUrls(doc: CanvasDocument): Promise<CanvasDocument> {
  let changed = false;
  const layers: CanvasLayer[] = [];
  for (const layer of doc.layers) {
    if (layer.type !== 'image' && layer.type !== 'logo') {
      layers.push(layer);
      continue;
    }
    const val = layer.value;
    if (!val || val.startsWith('data:') || val.startsWith('canvas-asset:') || val.startsWith('http') || val.startsWith('file:')) {
      layers.push(layer);
      continue;
    }
    let reg = blobMap.get(val);
    if (!reg && val.startsWith('blob:')) {
      const blobId = urlToBlobIdMap.get(val);
      if (blobId) reg = blobMap.get(blobId);
    }
    if (!reg) {
      layers.push(layer);
      continue;
    }
    const dataUrl = await blobToDataUrl(reg.blob);
    changed = true;
    layers.push({ ...layer, value: dataUrl });
  }
  return changed ? { ...doc, layers } : doc;
}

/**
 * Prepare image/logo layers for PDF export (RGB or CMYK).
 * - rgb (default): expand assets + blobs to data: URLs for HTML print.
 * - cmyk: persist blobs/data: as canvas-asset: refs so the IPC payload stays small;
 *   Python resolves refs from %LOCALAPPDATA%/Antares/canvas/assets.
 */
export async function prepareDocumentImagesForExport(
  doc: CanvasDocument,
  options?: { mode?: 'rgb' | 'cmyk' },
): Promise<CanvasDocument> {
  if (options?.mode === 'cmyk') {
    return prepareDocumentImagesForCmykExport(doc);
  }
  const withAssets = await embedCanvasAssetsAsDataUrls(doc, { strict: true });
  return embedManagedBlobsAsDataUrls(withAssets);
}

/**
 * CMYK path: prefer disk refs over inlining base64 into the JSON-RPC payload.
 */
export async function prepareDocumentImagesForCmykExport(doc: CanvasDocument): Promise<CanvasDocument> {
  let next = await serializeDocumentImages(doc, { preferAssetRefs: true });
  next = await persistDataUrlsAsCanvasAssets(next);
  // Unsaved blob: must not reach Python — fail loudly if any remain.
  for (const layer of next.layers) {
    if ((layer.type !== 'image' && layer.type !== 'logo') || !layer.value) continue;
    if (layer.value.startsWith('blob:') || blobMap.has(layer.value)) {
      throw new Error(`CMYK export: imagen sin persistir (${layer.id})`);
    }
  }
  return next;
}

type CanvasAssetGetter = (ref: string) => Promise<{ chunk: ArrayBuffer }>;

async function readCanvasAssetChunk(getAsset: CanvasAssetGetter, ref: string): Promise<ArrayBuffer> {
  const res = await getAsset(ref);
  if (!res?.chunk) throw new Error('asset vacío');
  return res.chunk;
}

/** Convert leftover data: layer values into canvas-asset: refs when Electron can store them. */
async function persistDataUrlsAsCanvasAssets(doc: CanvasDocument): Promise<CanvasDocument> {
  const putAsset = window.electronAPI?.canvasAssetPut;
  if (!putAsset) return doc;

  let changed = false;
  const layers: CanvasLayer[] = [];
  for (const layer of doc.layers) {
    if ((layer.type !== 'image' && layer.type !== 'logo') || !layer.value?.startsWith('data:')) {
      layers.push(layer);
      continue;
    }
    try {
      const res = await fetch(layer.value);
      const buf = await res.arrayBuffer();
      const stored = await putAsset(buf) as { ref: string };
      changed = true;
      layers.push({ ...layer, value: stored.ref });
    } catch {
      layers.push(layer);
    }
  }
  return changed ? { ...doc, layers } : doc;
}


/**
 * Hydrates a document loaded from disk / IPC for rendering.
 * Resolves `canvas-asset:` refs into blob: ObjectURLs; legacy data: URLs stay as-is.
 */
export async function hydrateDocumentImages(
  doc: CanvasDocument,
  options?: { strict?: boolean },
): Promise<CanvasDocument> {
  const strict = options?.strict === true;
  const getAsset = window.electronAPI?.canvasAssetGet;
  if (!getAsset) {
    if (strict && countCanvasAssetRefs(doc) > 0) {
      throw new Error('No se pueden resolver canvas-asset: sin Electron (canvasAssetGet)');
    }
    return doc;
  }

  let changed = false;
  const layers: CanvasLayer[] = [];
  for (const layer of doc.layers) {
    if ((layer.type !== 'image' && layer.type !== 'logo') || !layer.value?.startsWith('canvas-asset:')) {
      layers.push(layer);
      continue;
    }
    try {
      const chunk = await readCanvasAssetChunk(getAsset, layer.value);
      const blob = new Blob([chunk]);
      const reg = await registerImageBlob(blob);
      changed = true;
      layers.push({ ...layer, value: reg.url });
    } catch (err) {
      if (strict) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`No se pudo resolver ${layer.value}: ${msg}`);
      }
      layers.push(layer);
    }
  }
  const next = changed ? { ...doc, layers } : doc;
  if (strict && countCanvasAssetRefs(next) > 0) {
    throw new Error('Quedan referencias canvas-asset: sin resolver');
  }
  return next;
}

/** Verify persisted canvas assets without mutating the live image store. */
export async function assertDocumentImagesResolvable(doc: CanvasDocument): Promise<void> {
  const refs = canvasAssetRefs(doc);
  if (refs.length === 0) return;

  const getAsset = window.electronAPI?.canvasAssetGet;
  if (!getAsset) {
    throw new Error('No se pueden resolver canvas-asset: sin Electron (canvasAssetGet)');
  }

  for (const ref of refs) {
    try {
      await readCanvasAssetChunk(getAsset, ref);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`No se pudo resolver ${ref}: ${msg}`);
    }
  }
}

async function persistLayerImageValue(val: string): Promise<string> {
  if (
    val.startsWith('canvas-asset:')
    || val.startsWith('data:')
    || val.startsWith('http://')
    || val.startsWith('https://')
    || val.startsWith('file:')
  ) {
    return val;
  }
  let reg = blobMap.get(val);
  if (!reg && val.startsWith('blob:')) {
    const blobId = urlToBlobIdMap.get(val);
    if (blobId) reg = blobMap.get(blobId);
  }
  if (!reg) return val;

  const putAsset = window.electronAPI?.canvasAssetPut;
  if (putAsset) {
    try {
      const buf = await reg.blob.arrayBuffer();
      const stored = await putAsset(buf) as { ref: string };
      if (reg.dataUrl) delete reg.dataUrl;
      return stored.ref;
    } catch {
      // fall through to data URL
    }
  }
  const dataUrl = reg.dataUrl ?? (await blobToDataUrl(reg.blob));
  if (reg.dataUrl) delete reg.dataUrl;
  return dataUrl;
}

async function hydrateLayerImageValue(val: string): Promise<string> {
  if (!val.startsWith('canvas-asset:')) return val;
  const getAsset = window.electronAPI?.canvasAssetGet;
  if (!getAsset) return val;
  try {
    const chunk = await readCanvasAssetChunk(getAsset, val);
    const blob = new Blob([chunk]);
    const reg = await registerImageBlob(blob);
    return reg.url;
  } catch {
    return val;
  }
}

async function mapDiffImageValues(
  diff: CanvasDiff,
  mapValue: (value: string) => Promise<string>,
): Promise<CanvasDiff> {
  let changed = false;
  let addedLayers = diff.addedLayers;
  if (addedLayers?.length) {
    addedLayers = await Promise.all(
      addedLayers.map(async (layer) => {
        if ((layer.type !== 'image' && layer.type !== 'logo') || !layer.value) return layer;
        const next = await mapValue(layer.value);
        if (next === layer.value) return layer;
        changed = true;
        return { ...layer, value: next };
      }),
    );
  }
  let modifiedLayers = diff.modifiedLayers;
  if (modifiedLayers?.length) {
    modifiedLayers = await Promise.all(
      modifiedLayers.map(async (patch) => {
        if (typeof patch.changes.value !== 'string') return patch;
        const next = await mapValue(patch.changes.value);
        if (next === patch.changes.value) return patch;
        changed = true;
        return { ...patch, changes: { ...patch.changes, value: next } };
      }),
    );
  }
  return changed ? { ...diff, addedLayers, modifiedLayers } : diff;
}

/** Persist image values in undo/redo stacks (blob: → canvas-asset: / data:). */
export async function serializeHistorySteps(steps: HistoryStep[]): Promise<HistoryStep[]> {
  return Promise.all(
    steps.map(async (step) => {
      if (isHistoryStepDiff(step)) {
        const [undoDiff, redoDiff] = await Promise.all([
          mapDiffImageValues(step.undoDiff, persistLayerImageValue),
          mapDiffImageValues(step.redoDiff, persistLayerImageValue),
        ]);
        if (undoDiff === step.undoDiff && redoDiff === step.redoDiff) return step;
        return { ...step, undoDiff, redoDiff };
      }
      return serializeDocumentImages(step);
    }),
  );
}

/** Restore image values in undo/redo stacks (canvas-asset: → blob:). */
export async function hydrateHistorySteps(steps: HistoryStep[]): Promise<HistoryStep[]> {
  return Promise.all(
    steps.map(async (step) => {
      if (isHistoryStepDiff(step)) {
        const [undoDiff, redoDiff] = await Promise.all([
          mapDiffImageValues(step.undoDiff, hydrateLayerImageValue),
          mapDiffImageValues(step.redoDiff, hydrateLayerImageValue),
        ]);
        if (undoDiff === step.undoDiff && redoDiff === step.redoDiff) return step;
        return { ...step, undoDiff, redoDiff };
      }
      return hydrateDocumentImages(step);
    }),
  );
}

/**
 * Revokes a single managed ObjectURL (by blobId or blob: URL) and removes it from the store.
 */
export function releaseImageBlob(value: string | undefined): void {
  if (!value) return;

  const blobId = blobMap.has(value) ? value : urlToBlobIdMap.get(value);
  if (!blobId) return;

  const reg = blobMap.get(blobId);
  if (!reg) return;

  if (reg.url.startsWith('blob:')) URL.revokeObjectURL(reg.url);
  if (reg.thumbnailUrl && reg.thumbnailUrl !== reg.url && reg.thumbnailUrl.startsWith('blob:')) {
    URL.revokeObjectURL(reg.thumbnailUrl);
  }
  urlToBlobIdMap.delete(reg.url);
  blobMap.delete(blobId);
}

/**
 * Revokes managed ObjectURLs that are not referenced by any live value
 * (current doc, history, clipboard, …). Essential under Canvas keep-alive,
 * where `clearBlobStore` rarely runs because CanvasView stays mounted.
 *
 * @returns number of blobs released
 */
export function sweepOrphanBlobs(liveRefs: Iterable<string>): number {
  const live = liveRefs instanceof Set ? liveRefs : new Set(liveRefs);
  // Expand live set with paired blobId/url for any registered hits.
  for (const value of [...live]) {
    trackImageRef(live, value);
  }

  let released = 0;
  for (const blobId of [...blobMap.keys()]) {
    const reg = blobMap.get(blobId);
    if (!reg) continue;
    if (live.has(blobId) || live.has(reg.url)) continue;
    releaseImageBlob(blobId);
    released += 1;
  }
  return released;
}

/**
 * Revokes all managed ObjectURLs to free browser memory when tearing down or clearing.
 */
export function clearBlobStore(): void {
  for (const reg of blobMap.values()) {
    if (reg.url.startsWith('blob:')) URL.revokeObjectURL(reg.url);
    if (reg.thumbnailUrl && reg.thumbnailUrl !== reg.url && reg.thumbnailUrl.startsWith('blob:')) {
      URL.revokeObjectURL(reg.thumbnailUrl);
    }
  }
  blobMap.clear();
  urlToBlobIdMap.clear();
}
