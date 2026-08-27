import { api } from '../../api';
import {
  fileToPdfImageSource,
  getElectronFilePath,
  imageToPdfDataUrl,
  type PdfQuality,
} from '../../utils/pdfAssets';
import { mapWithConcurrencyLimit } from '../../utils/mapWithConcurrencyLimit';
import { registerLocalPaths } from '../../utils/registerLocalPath';
import { matchPhotosForId } from './photoMatch';
import type { PhotoAsset } from './types';

export type LogoAsset = { src: string; file: File | null };

export interface PreparedExportImages {
  images: Array<{ path: string; name: string }>;
  localImagePaths: Record<string, string>;
}

/** Prefer local file tokens. Never return raw data-URLs (they blow the 64MB IPC limit). */
export async function photoToPdfPath(
  photo: PhotoAsset,
  key: string,
  localImagePaths: Record<string, string>,
  quality: PdfQuality = 'high',
): Promise<string> {
  if (photo.file) {
    const localPath = getElectronFilePath(photo.file);
    if (localPath) {
      return fileToPdfImageSource(photo.file, key, localImagePaths);
    }
  }
  if (photo.src.startsWith('data:')) {
    try {
      const res = await fetch(photo.src);
      const blob = await res.blob();
      const file = new File([blob], photo.name || `${key}.jpg`, { type: blob.type || 'image/jpeg' });
      const compressed = await imageToPdfDataUrl(file, quality);
      // Guard: a single compressed image over ~1.5MB is still dangerous in batches.
      if (compressed.length > 1_500_000) {
        throw new Error(
          `La foto "${photo.name}" es demasiado grande para el consolidado. Vuelve a cargarla desde disco (Archivo → Cargar fotos) para usar la ruta local.`,
        );
      }
      return compressed;
    } catch (error) {
      if (error instanceof Error && error.message.includes('demasiado grande')) throw error;
      throw new Error(
        `No se pudo preparar "${photo.name}" para PDF. Vuelve a cargar las fotos desde disco e inténtalo de nuevo.`,
      );
    }
  }
  return photo.src;
}

export async function logoToPdfPath(
  logo: LogoAsset | null,
  key: string,
  localImagePaths: Record<string, string>,
): Promise<string | null> {
  if (!logo) return null;
  if (logo.file && getElectronFilePath(logo.file)) {
    return fileToPdfImageSource(logo.file, key, localImagePaths);
  }
  // Logos are small; data-URL fallback is acceptable.
  return logo.src;
}

export async function preparePhotosForExport(
  photos: PhotoAsset[],
  photoId: string,
  keyPrefix: string,
  localImagePaths: Record<string, string>,
  quality: PdfQuality = 'high',
): Promise<Array<{ path: string; name: string }>> {
  const matched = matchPhotosForId(photos, photoId);
  return mapWithConcurrencyLimit(matched, 4, async (photo, index) => ({
    path: await photoToPdfPath(photo, `${keyPrefix}-${index}`, localImagePaths, quality),
    name: photo.name,
  }));
}

export async function askPdfSavePath(defaultFilename: string, title: string): Promise<string | null> {
  const saveTarget = await api.dialogSave({
    title,
    defaultPath: defaultFilename,
    filters: [
      { name: 'PDF', extensions: ['pdf'] },
      { name: 'Todos los archivos', extensions: ['*'] },
    ],
  });
  return saveTarget.paths[0] || null;
}

export async function registerExportLocalPaths(localImagePaths: Record<string, string>): Promise<void> {
  const paths = Object.values(localImagePaths).filter(Boolean);
  // Also register any Electron File.path that might have been skipped
  await registerLocalPaths(paths);
}

export function collectFilePaths(files: Array<File | null | undefined>): string[] {
  const out: string[] = [];
  for (const file of files) {
    const p = file ? getElectronFilePath(file) : null;
    if (p) out.push(p);
  }
  return out;
}
