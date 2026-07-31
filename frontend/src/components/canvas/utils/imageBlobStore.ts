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
 * Creates a resized 400px max-dimension thumbnail Blob from a source image or Blob.
 */
export async function createThumbnailBlob(
  source: Blob | HTMLImageElement,
  maxDimension = 400
): Promise<{ thumbnailBlob: Blob; thumbnailUrl: string }> {
  let img: HTMLImageElement;
  let shouldRevokeImgUrl = false;

  if (source instanceof Blob) {
    img = new Image();
    const tempUrl = URL.createObjectURL(source);
    shouldRevokeImgUrl = true;
    img.src = tempUrl;
    await Promise.race([
      new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
      }),
      new Promise((resolve) => setTimeout(resolve, 100)),
    ]);
  } else {
    img = source;
  }

  const { naturalWidth: w, naturalHeight: h } = img;
  if (shouldRevokeImgUrl && img.src.startsWith('blob:')) {
    URL.revokeObjectURL(img.src);
  }

  if (!w || !h) {
    const fallbackBlob = source instanceof Blob ? source : new Blob([]);
    return {
      thumbnailBlob: fallbackBlob,
      thumbnailUrl: source instanceof Blob ? URL.createObjectURL(fallbackBlob) : img.src,
    };
  }

  const scale = Math.min(1, maxDimension / Math.max(w, h));
  const targetW = Math.max(1, Math.round(w * scale));
  const targetH = Math.max(1, Math.round(h * scale));

  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(img, 0, 0, targetW, targetH);
      const thumbnailBlob = await new Promise<Blob>((resolve) => {
        canvas.toBlob((b) => resolve(b || new Blob([])), 'image/jpeg', 0.85);
      });
      return {
        thumbnailBlob,
        thumbnailUrl: URL.createObjectURL(thumbnailBlob),
      };
    }
  }

  const fallback = source instanceof Blob ? source : new Blob([]);
  return {
    thumbnailBlob: fallback,
    thumbnailUrl: source instanceof Blob ? URL.createObjectURL(fallback) : img.src,
  };
}

/**
 * Registers an image Blob or File into the in-memory Blob Store.
 * Creates an ObjectURL and a 400px thumbnail.
 */
export async function registerImageBlob(
  fileOrBlob: Blob | File,
  existingDataUrl?: string
): Promise<RegisteredBlob> {
  const blobId = generateBlobId();
  const url = URL.createObjectURL(fileOrBlob);

  let width = 0;
  let height = 0;
  let thumbnailUrl = url;

  if (typeof document !== 'undefined') {
    try {
      const img = new Image();
      img.src = url;
      await Promise.race([
        new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = reject;
        }),
        new Promise((resolve) => setTimeout(resolve, 100)),
      ]);
      width = img.naturalWidth;
      height = img.naturalHeight;

      const thumbResult = await createThumbnailBlob(img, 400);
      thumbnailUrl = thumbResult.thumbnailUrl;
    } catch {
      thumbnailUrl = url;
    }
  }

  const registered: RegisteredBlob = {
    blobId,
    blob: fileOrBlob,
    url,
    thumbnailUrl,
    width,
    height,
    dataUrl: existingDataUrl,
  };

  blobMap.set(blobId, registered);
  urlToBlobIdMap.set(url, blobId);

  return registered;
}

/**
 * Converts a Base64 DataURL string into a Blob and registers it.
 */
export async function registerDataUrlImage(dataUrl: string): Promise<RegisteredBlob> {
  if (!dataUrl.startsWith('data:')) {
    const existingId = urlToBlobIdMap.get(dataUrl);
    if (existingId && blobMap.has(existingId)) {
      return blobMap.get(existingId)!;
    }
  }

  try {
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    return await registerImageBlob(blob, dataUrl);
  } catch {
    const dummyBlob = new Blob([dataUrl], { type: 'text/plain' });
    return await registerImageBlob(dummyBlob, dataUrl);
  }
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
          if (!reg.dataUrl) {
            reg.dataUrl = await blobToDataUrl(reg.blob);
          }
          return { ...layer, value: reg.dataUrl };
        }
      }
      return layer;
    })
  );

  return { ...doc, layers: updatedLayers };
}

/**
 * Hydrates a document loaded from disk / IPC by registering heavy base64 dataURLs
 * as in-memory Blobs and ObjectURLs for light, fast rendering during the active session.
 */
export async function hydrateDocumentImages(doc: CanvasDocument): Promise<CanvasDocument> {
  const updatedLayers: CanvasLayer[] = await Promise.all(
    doc.layers.map(async (layer) => {
      if ((layer.type === 'image' || layer.type === 'logo') && layer.value) {
        if (layer.value.startsWith('data:image/')) {
          const registered = await registerDataUrlImage(layer.value);
          return { ...layer, value: registered.url };
        }
      }
      return layer;
    })
  );

  return { ...doc, layers: updatedLayers };
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
