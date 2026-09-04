import { base64ToBytes } from './bytesToBase64';
import { stageFileForIpc } from './stageFile';

export type PdfQuality = 'max' | 'high' | 'low';

export interface PdfImageSource {
  src: string;
  fileToken?: string;
  token?: string;
}

const LOCAL_IMAGE_TOKEN_PREFIX = 'antares-local-image:';

const STAGEABLE_IMAGE_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif', '.tif', '.tiff', '.ico',
]);

const STAGE_CONCURRENCY = 4;
export const MAX_PDF_STAGE_QUEUE = 32;
const PDF_STAGE_CAPACITY_ERROR = 'PDF image staging queue capacity exhausted';
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
    else if (stageWaiters.length < MAX_PDF_STAGE_QUEUE) stageWaiters.push(start);
    else reject(new Error(PDF_STAGE_CAPACITY_ERROR));
  });
}

function stageFileForPdf(file: File): Promise<string | null> {
  const dot = file.name.lastIndexOf('.');
  const ext = dot >= 0 ? file.name.slice(dot).toLowerCase() : '';
  if (!STAGEABLE_IMAGE_EXTENSIONS.has(ext)) return Promise.resolve(null);
  return runStagedLimited(() => stageFileForIpc(file));
}

export function fileToDataUrl(file: File): Promise<string> {
  if (typeof FileReader === 'undefined' && typeof file.arrayBuffer === 'function') {
    return file.arrayBuffer().then(bytes => {
      let binary = '';
      const chunkSize = 0x8000;
      for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
        binary += String.fromCharCode(...new Uint8Array(bytes, offset, Math.min(chunkSize, bytes.byteLength - offset)));
      }
      return `data:${file.type || 'application/octet-stream'};base64,${btoa(binary)}`;
    });
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('No se pudo leer el archivo'));
    reader.readAsDataURL(file);
  });
}

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
  try {
    const fromApi = window.electronAPI?.getPathForFile?.(file);
    if (typeof fromApi === 'string' && fromApi.trim()) return fromApi.trim();
  } catch {
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
  const staged = await stageFileForPdf(file);
  if (staged) {
    const token = buildLocalImageToken(key);
    localImagePaths[token] = staged;
    return token;
  }
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

async function stageImageForPdf(file: File, quality: PdfQuality): Promise<string | null> {
  if (quality === 'max') return stageFileForPdf(file);
  try {
    const { processImageFileForCanvas } = await import('../components/canvas/workers/imageProcessorClient');
    const maxDim = quality === 'high' ? 2600 : 1400;
    const q = quality === 'high' ? 0.9 : 0.68;
    const { blob } = await processImageFileForCanvas(file, maxDim, { quality: q, outputType: 'image/jpeg' });
    if (blob === file) return stageFileForPdf(file);
    const base = file.name.replace(/\.[^.]+$/, '') || 'imagen';
    const jpeg = new File([blob], `${base}.jpg`, { type: 'image/jpeg' });
    return await stageFileForPdf(jpeg);
  } catch {
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
}

export async function imageToPdfSource(
  file: File,
  quality: PdfQuality,
  key: string,
): Promise<PdfImageSource> {
  const staged = await stageImageForPdf(file, quality);
  if (staged) {
    const token = buildLocalImageToken(key);
    return { src: token, fileToken: staged, token };
  }

  if (quality === 'max' || quality === 'high') {
    return { src: await imageToPdfDataUrl(file, quality === 'max' ? 'high' : quality) };
  }

  return { src: await imageToPdfDataUrl(file, quality) };
}

export async function logoToPdfSource(
  url: string | null,
  file: File | null,
  key: string,
  localImagePaths: Record<string, string>,
  useLocalTokens: boolean,
): Promise<string | null> {
  if (!url) return null;
  if (useLocalTokens && file) {
    const staged = await stageFileForPdf(file);
    if (staged) {
      const token = buildLocalImageToken(key);
      localImagePaths[token] = staged;
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
