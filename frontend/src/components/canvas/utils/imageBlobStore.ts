import type { CanvasDocument, CanvasLayer } from '../types';

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

/** Helper to generate unique blob IDs */
function generateBlobId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `img_blob_${crypto.randomUUID()}`;
  }
  return `img_blob_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Registers an image Blob or File into the in-memory Blob Store.
 * Creates an ObjectURL. Thumbnails/dimensions are intentionally NOT computed
 * here: decoding + re-encoding every image on the main thread was the dominant
 * startup bottleneck, and renderers fall back to the full ObjectURL.
 */
export async function registerImageBlob(
  fileOrBlob: Blob | File,
  existingDataUrl?: string
): Promise<RegisteredBlob> {
  const blobId = generateBlobId();
  const url = URL.createObjectURL(fileOrBlob);

  const registered: RegisteredBlob = {
    blobId,
    blob: fileOrBlob,
    url,
    thumbnailUrl: url,
    width: 0,
    height: 0,
    dataUrl: existingDataUrl,
  };

  blobMap.set(blobId, registered);
  urlToBlobIdMap.set(url, blobId);

  return registered;
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
 * back into persistent DataURLs or path strings.
 */
export async function serializeDocumentImages(doc: CanvasDocument): Promise<CanvasDocument> {
  const updatedLayers: CanvasLayer[] = await Promise.all(
    doc.layers.map(async (layer) => {
      if (layer.type === 'image' || layer.type === 'logo') {
        const val = layer.value;
        if (!val) return layer;

        let reg = blobMap.get(val);
        if (!reg && val.startsWith('blob:')) {
          const blobId = urlToBlobIdMap.get(val);
          if (blobId) reg = blobMap.get(blobId);
        }

        if (reg) {
          // Compute a persistent data URL for the saved document, but do not
          // keep it on the RegisteredBlob — that would retain ~2× the bytes
          // (Blob + base64) for the whole session while keep-alive holds the store.
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
 * Hydrates a document loaded from disk / IPC for rendering.
 *
 * Startup fast-path: images are kept as their persistent `dataUrl` and
 * rendered directly (LayerNode and the sidebar already fall back to the raw
 * value), so opening a document no longer decodes + re-encodes a thumbnail
 * for every image on the main thread. In-session image drops go through
 * `registerImageBlob` above, which yields lightweight blob: ObjectURLs.
 */
export async function hydrateDocumentImages(doc: CanvasDocument): Promise<CanvasDocument> {
  return doc;
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
