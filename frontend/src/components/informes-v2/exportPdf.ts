import { api } from '../../api';
import {
  fileToPdfImageSource,
  imageToPdfDataUrl,
  type PdfQuality,
} from '../../utils/pdfAssets';
import { mapWithConcurrencyLimit } from '../../utils/mapWithConcurrencyLimit';
import { matchPhotosForId } from './photoMatch';
import type { PhotoAsset } from './types';

export type LogoAsset = { src: string; file: File | null };

export interface PreparedExportImages {
  images: Array<{ path: string; name: string }>;
  localImagePaths: Record<string, string>;
}

export async function photoToPdfPath(
  photo: PhotoAsset,
  key: string,
  localImagePaths: Record<string, string>,
  quality: PdfQuality = 'high',
): Promise<string> {
  if (photo.file) return fileToPdfImageSource(photo.file, key, localImagePaths);
  if (photo.src.startsWith('data:')) {
    try {
      const res = await fetch(photo.src);
      const blob = await res.blob();
      const file = new File([blob], photo.name || `${key}.jpg`, { type: blob.type || 'image/jpeg' });
      const compressed = await imageToPdfDataUrl(file, quality);
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
  if (logo.file) return fileToPdfImageSource(logo.file, key, localImagePaths);
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
