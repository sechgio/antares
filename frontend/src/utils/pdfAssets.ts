export type PdfQuality = 'high' | 'low';

export interface PdfImageSource {
  src: string;
  localPath?: string;
  token?: string;
}

const LOCAL_IMAGE_TOKEN_PREFIX = 'antares-local-image:';

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('No se pudo leer el archivo'));
    reader.readAsDataURL(file);
  });
}

export async function fileToBase64(file: File): Promise<string> {
  const value = await fileToDataUrl(file);
  return value.includes(',') ? value.split(',')[1] : value;
}

export function getElectronFilePath(file: File): string | null {
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
  if (localPath) {
    const token = buildLocalImageToken(key);
    localImagePaths[token] = localPath;
    return token;
  }
  return fileToDataUrl(file);
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

export async function imageToPdfSource(
  file: File,
  quality: PdfQuality,
  key: string,
): Promise<PdfImageSource> {
  if (quality === 'high') {
    const localPath = getElectronFilePath(file);
    if (localPath) {
      const token = buildLocalImageToken(key);
      return { src: token, localPath, token };
    }
  }

  return { src: await imageToPdfDataUrl(file, quality) };
}

export function downloadBase64Pdf(pdfBase64: string, filename: string): void {
  const binary = atob(pdfBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
