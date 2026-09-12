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
let imageProcessorModulePromise: Promise<typeof import('../workers/imageProcessorClient')> | null = null;

function loadImageProcessor() {
  if (!imageProcessorModulePromise) {
    imageProcessorModulePromise = import('../workers/imageProcessorClient').catch((error) => {
      imageProcessorModulePromise = null;
      throw error;
    });
  }
  return imageProcessorModulePromise;
}

function isManagedImageValue(value: string | undefined): value is string {
  if (!value) return false;
  return value.startsWith('blob:') || value.startsWith('img_blob_') || blobMap.has(value);
}

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

function generateBlobId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `img_blob_${crypto.randomUUID()}`;
  }
  return `img_blob_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export async function registerImageBlob(
  fileOrBlob: Blob | File,
  existingDataUrl?: string,
  opts?: { maxDimension?: number },
): Promise<RegisteredBlob> {
  let blob: Blob = fileOrBlob;
  let width = 0;
  let height = 0;

  if (fileOrBlob instanceof File && fileOrBlob.type.startsWith('image/')) {
    try {
      const { processImageFileForCanvas } = await loadImageProcessor();
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

export async function registerAndPersistCanvasImage(
  blob: Blob,
): Promise<string> {
  const registered = await registerImageBlob(blob);
  const putAsset = window.electronAPI?.canvasAssetPut;
  if (!putAsset) return registered.url;
  try {
    await persistRegisteredBlob(registered, putAsset as CanvasAssetPutter, true);
  } catch {
  }
  return registered.url;
}

export function getBlobUrl(value: string | undefined): string {
  if (!value) return '';
  if (value.startsWith('blob:') || value.startsWith('http://') || value.startsWith('https://')) {
    return value;
  }
  const reg = blobMap.get(value);
  if (reg) return reg.url;
  return value;
}

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

export async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

type CanvasAssetPutter = (chunk: ArrayBuffer | Uint8Array) => Promise<{ ref?: string }>;

let assetPersistenceChain: Promise<unknown> = Promise.resolve();
const inFlightAssetPersistence = new WeakMap<Blob, Promise<string>>();

function withAssetPersistenceLock<T>(work: () => Promise<T>): Promise<T> {
  const next = assetPersistenceChain.then(work);
  assetPersistenceChain = next.catch(() => undefined);
  return next;
}

function persistRegisteredBlob(
  reg: RegisteredBlob,
  putAsset: CanvasAssetPutter | undefined,
  preferAssetRefs: boolean,
): Promise<string> {
  const inFlight = inFlightAssetPersistence.get(reg.blob);
  if (inFlight) return inFlight;

  const next = preferAssetRefs && putAsset
    ? withAssetPersistenceLock(async () => {
        try {
          const stored = await putAsset(await reg.blob.arrayBuffer());
          if (stored?.ref) return stored.ref;
        } catch {
        }
        return null;
      }).then((storedRef) => storedRef ?? reg.dataUrl ?? blobToDataUrl(reg.blob))
    : Promise.resolve(reg.dataUrl ?? blobToDataUrl(reg.blob));
  inFlightAssetPersistence.set(reg.blob, next);
  void next
    .finally(() => {
      if (inFlightAssetPersistence.get(reg.blob) === next) {
        inFlightAssetPersistence.delete(reg.blob);
      }
    })
    .catch(() => undefined);
  return next;
}

export async function serializeDocumentImages(
  doc: CanvasDocument,
  options?: { preferAssetRefs?: boolean },
): Promise<CanvasDocument> {
  const preferAssetRefs = options?.preferAssetRefs !== false;
  const putAsset = window.electronAPI?.canvasAssetPut as CanvasAssetPutter | undefined;
  const serializedByBlob = new WeakMap<Blob, Promise<string>>();
  const updatedLayers: CanvasLayer[] = [];

  for (const layer of doc.layers) {
    if (layer.type !== 'image' && layer.type !== 'logo') {
      updatedLayers.push(layer);
      continue;
    }
    const val = layer.value;
    if (!val || val.startsWith('canvas-asset:')) {
      updatedLayers.push(layer);
      continue;
    }

    let reg = blobMap.get(val);
    if (!reg && val.startsWith('blob:')) {
      const blobId = urlToBlobIdMap.get(val);
      if (blobId) reg = blobMap.get(blobId);
    }
    if (!reg) {
      updatedLayers.push(layer);
      continue;
    }

    let serialized = serializedByBlob.get(reg.blob);
    if (!serialized) {
      serialized = persistRegisteredBlob(reg, putAsset, preferAssetRefs);
      serializedByBlob.set(reg.blob, serialized);
    }
    const serializedValue = await serialized;
    if (reg.dataUrl) delete reg.dataUrl;
    updatedLayers.push({ ...layer, value: serializedValue });
  }

  return { ...doc, layers: updatedLayers };
}

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
  const dataUrlByRef = new Map<string, string>();
  const readErrorsByRef = new Map<string, unknown>();
  await Promise.all([...new Set(canvasAssetRefs(doc))].map(async (ref) => {
    try {
      const chunk = await readCanvasAssetShared(getAsset, ref);
      dataUrlByRef.set(ref, await blobToDataUrl(new Blob([chunk])));
    } catch (err) {
      readErrorsByRef.set(ref, err);
    }
  }));

  const layers: CanvasLayer[] = [];
  for (const layer of doc.layers) {
    if ((layer.type !== 'image' && layer.type !== 'logo') || !layer.value?.startsWith('canvas-asset:')) {
      layers.push(layer);
      continue;
    }
    const dataUrl = dataUrlByRef.get(layer.value);
    if (dataUrl !== undefined) {
      changed = true;
      layers.push({ ...layer, value: dataUrl });
      continue;
    }
    if (strict) {
      const err = readErrorsByRef.get(layer.value);
      const msg = err instanceof Error ? err.message : String(err ?? 'asset vacío');
      throw new Error(`No se pudo resolver ${layer.value}: ${msg}`);
    }
    layers.push(layer);
  }
  const next = changed ? { ...doc, layers } : doc;
  return next;
}

export function countCanvasAssetRefs(doc: CanvasDocument): number {
  return canvasAssetRefs(doc).length;
}

export async function assertCanvasAssetExpansionWithinBytes(
  doc: CanvasDocument,
  maxBytes: number,
): Promise<void> {
  const refs = canvasAssetRefs(doc);
  if (refs.length === 0) return;

  const getInfo = window.electronAPI?.canvasAssetInfo;
  if (!getInfo) return;

  const occurrences = new Map<string, number>();
  for (const ref of refs) occurrences.set(ref, (occurrences.get(ref) ?? 0) + 1);

  const compactLayers = doc.layers.map((layer) => (
    (layer.type === 'image' || layer.type === 'logo') && layer.value?.startsWith('canvas-asset:')
      ? { ...layer, value: '' }
      : layer
  ));
  const baseBytes = new TextEncoder().encode(JSON.stringify({ ...doc, layers: compactLayers })).byteLength;
  let estimatedBytes = baseBytes;
  const dataUrlPrefixBytes = 'data:application/octet-stream;base64,'.length;

  for (const [ref, occurrenceCount] of occurrences) {
    const info = await getInfo(ref);
    const assetBytes = info?.bytes;
    if (!Number.isFinite(assetBytes) || assetBytes < 0) {
      throw new Error(`No se pudo estimar el tamaño del asset Canvas ${ref}`);
    }
    const encodedBytes = 4 * Math.ceil(assetBytes / 3);
    estimatedBytes += (dataUrlPrefixBytes + encodedBytes) * occurrenceCount;
    if (estimatedBytes > maxBytes) {
      throw new Error('El documento Canvas excede el límite de 16 MiB para sincronización');
    }
  }
}

function canvasAssetRefs(doc: CanvasDocument): string[] {
  return doc.layers.flatMap((layer) => (
    (layer.type === 'image' || layer.type === 'logo') && layer.value?.startsWith('canvas-asset:')
      ? [layer.value]
      : []
  ));
}

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

export async function prepareDocumentImagesForCmykExport(doc: CanvasDocument): Promise<CanvasDocument> {
  let next = await serializeDocumentImages(doc, { preferAssetRefs: true });
  next = await persistDataUrlsAsCanvasAssets(next);
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

const inflightAssetReads = new Map<string, Promise<ArrayBuffer>>();

function readCanvasAssetShared(getAsset: CanvasAssetGetter, ref: string): Promise<ArrayBuffer> {
  const existing = inflightAssetReads.get(ref);
  if (existing) return existing;
  const promise = readCanvasAssetChunk(getAsset, ref);
  inflightAssetReads.set(ref, promise);
  const settle = () => {
    if (inflightAssetReads.get(ref) === promise) inflightAssetReads.delete(ref);
  };
  void promise.then(settle, settle);
  return promise;
}

async function persistDataUrlsAsCanvasAssets(doc: CanvasDocument): Promise<CanvasDocument> {
  const putAsset = window.electronAPI?.canvasAssetPut as CanvasAssetPutter | undefined;
  if (!putAsset) return doc;

  let changed = false;
  const layers: CanvasLayer[] = [];
  for (const layer of doc.layers) {
    if ((layer.type !== 'image' && layer.type !== 'logo') || !layer.value?.startsWith('data:')) {
      layers.push(layer);
      continue;
    }
    try {
      const storedRef = await withAssetPersistenceLock(async () => {
        const res = await fetch(layer.value);
        const buf = await res.arrayBuffer();
        const stored = await putAsset(buf);
        if (!stored?.ref) throw new Error('asset ref missing');
        return stored.ref;
      });
      changed = true;
      layers.push({ ...layer, value: storedRef });
    } catch {
      layers.push(layer);
    }
  }
  return changed ? { ...doc, layers } : doc;
}

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
  const assetChunkByRef = new Map<string, ArrayBuffer>();
  const readErrorsByRef = new Map<string, unknown>();
  await Promise.all([...new Set(canvasAssetRefs(doc))].map(async (ref) => {
    try {
      assetChunkByRef.set(ref, await readCanvasAssetShared(getAsset, ref));
    } catch (err) {
      readErrorsByRef.set(ref, err);
    }
  }));

  const layers: CanvasLayer[] = [];
  for (const layer of doc.layers) {
    if ((layer.type !== 'image' && layer.type !== 'logo') || !layer.value?.startsWith('canvas-asset:')) {
      layers.push(layer);
      continue;
    }
    const chunk = assetChunkByRef.get(layer.value);
    if (!chunk) {
      const err = readErrorsByRef.get(layer.value);
      if (strict) {
        const msg = err instanceof Error ? err.message : String(err ?? 'asset vacío');
        throw new Error(`No se pudo resolver ${layer.value}: ${msg}`);
      }
      layers.push(layer);
      continue;
    }
    const reg = await registerImageBlob(new Blob([chunk]));
    changed = true;
    layers.push({ ...layer, value: reg.url });
  }
  const next = changed ? { ...doc, layers } : doc;
  if (strict && countCanvasAssetRefs(next) > 0) {
    throw new Error('Quedan referencias canvas-asset: sin resolver');
  }
  return next;
}

export async function assertDocumentImagesResolvable(doc: CanvasDocument): Promise<void> {
  const refs = canvasAssetRefs(doc);
  if (refs.length === 0) return;

  const getAsset = window.electronAPI?.canvasAssetGet;
  if (!getAsset) {
    throw new Error('No se pueden resolver canvas-asset: sin Electron (canvasAssetGet)');
  }

  const failures = new Map<string, unknown>();
  await Promise.all([...new Set(refs)].map(async (ref) => {
    try {
      await readCanvasAssetShared(getAsset, ref);
    } catch (err) {
      failures.set(ref, err);
    }
  }));
  for (const ref of new Set(refs)) {
    const err = failures.get(ref);
    if (err !== undefined) {
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

  const putAsset = window.electronAPI?.canvasAssetPut as CanvasAssetPutter | undefined;
  const dataUrl = await persistRegisteredBlob(reg, putAsset, Boolean(putAsset));
  if (reg.dataUrl) delete reg.dataUrl;
  return dataUrl;
}

async function hydrateLayerImageValue(val: string): Promise<string> {
  if (!val.startsWith('canvas-asset:')) return val;
  const getAsset = window.electronAPI?.canvasAssetGet;
  if (!getAsset) return val;
  try {
    const chunk = await readCanvasAssetShared(getAsset, val);
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
    const mappedLayers = [];
    for (const layer of addedLayers) {
      if ((layer.type !== 'image' && layer.type !== 'logo') || !layer.value) {
        mappedLayers.push(layer);
        continue;
      }
      const next = await mapValue(layer.value);
      if (next === layer.value) mappedLayers.push(layer);
      else {
        changed = true;
        mappedLayers.push({ ...layer, value: next });
      }
    }
    addedLayers = mappedLayers;
  }
  let modifiedLayers = diff.modifiedLayers;
  if (modifiedLayers?.length) {
    const mappedPatches = [];
    for (const patch of modifiedLayers) {
      if (typeof patch.changes.value !== 'string') {
        mappedPatches.push(patch);
        continue;
      }
      const next = await mapValue(patch.changes.value);
      if (next === patch.changes.value) mappedPatches.push(patch);
      else {
        changed = true;
        mappedPatches.push({ ...patch, changes: { ...patch.changes, value: next } });
      }
    }
    modifiedLayers = mappedPatches;
  }
  return changed ? { ...diff, addedLayers, modifiedLayers } : diff;
}

export async function serializeHistorySteps(steps: HistoryStep[]): Promise<HistoryStep[]> {
  const serialized: HistoryStep[] = [];
  for (const step of steps) {
    if (isHistoryStepDiff(step)) {
      const undoDiff = await mapDiffImageValues(step.undoDiff, persistLayerImageValue);
      const redoDiff = await mapDiffImageValues(step.redoDiff, persistLayerImageValue);
      if (undoDiff === step.undoDiff && redoDiff === step.redoDiff) serialized.push(step);
      else serialized.push({ ...step, undoDiff, redoDiff });
    } else {
      serialized.push(await serializeDocumentImages(step));
    }
  }
  return serialized;
}

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

export function sweepOrphanBlobs(liveRefs: Iterable<string>): number {
  const live = liveRefs instanceof Set ? liveRefs : new Set(liveRefs);
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

export function clearBlobStore(): void {
  for (const reg of blobMap.values()) {
    if (reg.url.startsWith('blob:')) URL.revokeObjectURL(reg.url);
    if (reg.thumbnailUrl && reg.thumbnailUrl !== reg.url && reg.thumbnailUrl.startsWith('blob:')) {
      URL.revokeObjectURL(reg.thumbnailUrl);
    }
  }
  blobMap.clear();
  urlToBlobIdMap.clear();
  const processorModule = imageProcessorModulePromise;
  imageProcessorModulePromise = null;
  if (processorModule) {
    void processorModule.then(({ disposeImageProcessorWorker }) => disposeImageProcessorWorker(), () => {});
  }
}
