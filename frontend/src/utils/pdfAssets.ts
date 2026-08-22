import { base64ToBytes } from './bytesToBase64';
import { registerLocalPath } from './registerLocalPath';
import { stageFileForIpc } from './stageFile';

export type PdfQuality = 'max' | 'high' | 'low';

export interface PdfImageSource {
  src: string;
  localPath?: string;
  token?: string;
}

const LOCAL_IMAGE_TOKEN_PREFIX = 'antares-local-image:';

/** Espejo del allowlist de extensiones en electron/dialog-handlers.js (_localImageEntries). */
const STAGEABLE_IMAGE_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif', '.tif', '.tiff', '.ico',
]);

/** Limita las subidas escenificadas concurrentes: un consolidado grande no debe
 *  mantener todas las fotos en memoria a la vez. */
const STAGE_CONCURRENCY = 4;
let stageInFlight = 0;
const stageWaiters: Array<() => void> = [];

function runStagedLimited<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const start = () => {
      stageInFlight += 1;
      fn()
        .then(resolve, reject)
        .finally(() => {
          stageInFlight -= 1;
          const next = stageWaiters.shift();
          if (next) next();
        });
    };
    if (stageInFlight < STAGE_CONCURRENCY) start();
    else stageWaiters.push(start);
  });
}

/** Un archivo temporal por objeto File (los paneles duplicados comparten el mismo File). */
const stagedFileTokens = new WeakMap<File, Promise<string | null>>();

function stageFileForPdf(file: File): Promise<string | null> {
  const dot = file.name.lastIndexOf('.');
  const ext = dot >= 0 ? file.name.slice(dot).toLowerCase() : '';
  if (!STAGEABLE_IMAGE_EXTENSIONS.has(ext)) return Promise.resolve(null);
  const cached = stagedFileTokens.get(file);
  if (cached) return cached;
  const pending = runStagedLimited(async () => {
    try {
      return await stageFileForIpc(file);
    } catch {
      return null;
    }
  });
  stagedFileTokens.set(file, pending);
  return pending;
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('No se pudo leer el archivo'));
    reader.readAsDataURL(file);
  });
}

/** Persist blob:/http(s) URLs to data: for PDF export (cross-context safe). */
export async function toPersistentUrl(url: string | null): Promise<string | null> {
  if (!url) return null;
  if (url.startsWith('data:')) return url;
  if (!url.startsWith('blob:') && !url.startsWith('http://') && !url.startsWith('https://')) {
    return url;
  }
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  } catch {
    return url;
  }
}

export async function fileToBase64(file: File): Promise<string> {
  const value = await fileToDataUrl(file);
  return value.includes(',') ? value.split(',')[1] : value;
}

export function getElectronFilePath(file: File): string | null {
  // Electron 32+ removed File.path — preload exposes webUtils.getPathForFile.
  try {
    const fromApi = window.electronAPI?.getPathForFile?.(file);
    if (typeof fromApi === 'string' && fromApi.trim()) return fromApi.trim();
  } catch {
    /* preload unavailable (unit tests / non-Electron) */
  }
  const maybePath = (file as File & { path?: unknown }).path;
  return typeof maybePath === 'string' && maybePath.trim() ? maybePath : null;
}

export function buildLocalImageToken(key: string): string {
  return `${LOCAL_IMAGE_TOKEN_PREFIX}${key.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
}

export async function fileToPdfImageSource(
  file: File,
  key: string,
  localImagePaths: Record<string, string>,
): Promise<string> {
  const localPath = getElectronFilePath(file);
  if (localPath && (await registerLocalPath(localPath))) {
    const token = buildLocalImageToken(key);
    localImagePaths[token] = localPath;
    return token;
  }
  // register_local_path está deprecado en main. Las fotos sin ruta registrable
  // (persistidas en IndexedDB, blobs) se escenifican en un temp file de main y
  // el HTML referencia el capability token: el HTML no crece con la cantidad de
  // fotos y no toca el límite de payload IPC.
  const staged = await stageFileForPdf(file);
  if (staged) {
    const token = buildLocalImageToken(key);
    localImagePaths[token] = staged;
    return token;
  }
  // Sin Electron (tests / navegador) o sin staging: comprimir en vez de mandar
  // la foto a resolución completa por IPC.
  return imageToPdfDataUrl(file, 'high');
}

function compressImageForPdf(
  file: File,
  options: { maxSide: number; quality: number },
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      try {
        const { maxSide, quality } = options;
        const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
        const width = Math.max(1, Math.round(img.naturalWidth * scale));
        const height = Math.max(1, Math.round(img.naturalHeight * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas no disponible');
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      } catch (err) {
        reject(err);
      } finally {
        URL.revokeObjectURL(url);
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('No se pudo optimizar la imagen'));
    };

    img.src = url;
  });
}

export async function imageToPdfDataUrl(file: File, quality: PdfQuality): Promise<string> {
  if (quality === 'max') {
    return fileToDataUrl(file);
  }
  if (quality === 'high') {
    try {
      return await compressImageForPdf(file, { maxSide: 2600, quality: 0.9 });
    } catch {
      return fileToDataUrl(file);
    }
  }
  try {
    return await compressImageForPdf(file, { maxSide: 1400, quality: 0.68 });
  } catch {
    return fileToDataUrl(file);
  }
}

/**
 * Escenifica una versión apta para PDF del archivo. 'high'/'low' se comprimen
 * a JPEG por canvas (mismo criterio que el fallback data-URL de hoy); 'max'
 * escenifica el archivo original. Devuelve un capability token o null.
 */
async function stageImageForPdf(file: File, quality: PdfQuality): Promise<string | null> {
  if (quality === 'max') return stageFileForPdf(file);
  try {
    const dataUrl = await imageToPdfDataUrl(file, quality);
    const comma = dataUrl.indexOf(',');
    const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : '';
    const base = file.name.replace(/\.[^.]+$/, '') || 'imagen';
    const jpeg = new File([base64ToBytes(b64)], `${base}.jpg`, { type: 'image/jpeg' });
    return await stageFileForPdf(jpeg);
  } catch {
    return stageFileForPdf(file);
  }
}

export async function imageToPdfSource(
  file: File,
  quality: PdfQuality,
  key: string,
): Promise<PdfImageSource> {
  // register_local_path está deprecado en main. Se escenifica el archivo (o su
  // versión comprimida según la calidad) y el HTML referencia el capability
  // token: el HTML no crece con la cantidad de imágenes (consolidados de
  // cientos de fotos reventaban el límite de 150 MB de html_to_pdf).
  const staged = await stageImageForPdf(file, quality);
  if (staged) {
    const token = buildLocalImageToken(key);
    return { src: token, localPath: staged, token };
  }

  if (quality === 'max' || quality === 'high') {
    const localPath = getElectronFilePath(file);
    if (localPath) {
      if (await registerLocalPath(localPath)) {
        const token = buildLocalImageToken(key);
        return { src: token, localPath, token };
      }
      // Register failed — never fall back to full-res max over IPC.
      return { src: await imageToPdfDataUrl(file, quality === 'max' ? 'high' : quality) };
    }
  }

  return { src: await imageToPdfDataUrl(file, quality) };
}

/**
 * Logo source for canvas RGB PDF export. When the logo came from a local File
 * and its path is allowlisted, return an `antares-local-image:` token that
 * Electron expands to a file:// URL — the logo is referenced ONCE instead of
 * being base64-duplicated on every page (O(pages × logo size) → O(pages)).
 * Any other case falls back to the durable data: URL (same contract as the
 * previous always-base64 behavior). CMYK keeps base64: the backend renderer
 * does not resolve local image tokens.
 */
export async function logoToPdfSource(
  url: string | null,
  file: File | null,
  key: string,
  localImagePaths: Record<string, string>,
  useLocalTokens: boolean,
): Promise<string | null> {
  if (!url) return null;
  if (useLocalTokens && file) {
    const localPath = getElectronFilePath(file);
    if (localPath && (await registerLocalPath(localPath))) {
      const token = buildLocalImageToken(key);
      localImagePaths[token] = localPath;
      return token;
    }
  }
  return toPersistentUrl(url);
}

export function buildTimestampedFilename(prefix: string, format: string): string {
  const now = new Date();
  const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
  return `${prefix}_${ts}.${format}`;
}

export function downloadBase64Blob(contentB64: string, filename: string, mimeType: string): void {
  const bytes = base64ToBytes(contentB64);
  const blob = new Blob([bytes], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function downloadBase64Pdf(pdfBase64: string, filename: string): void {
  downloadBase64Blob(pdfBase64, filename, 'application/pdf');
}
