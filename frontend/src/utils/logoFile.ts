import { fileToDataUrl } from './pdfAssets';

export async function changeLogoFile(
  file: File | null,
  apply: (dataUrl: string | null, file: File | null) => void,
  onError: (error: unknown) => void,
): Promise<void> {
  if (!file) {
    apply(null, null);
    return;
  }
  try {
    apply(await fileToDataUrl(file), file);
  } catch (error) {
    onError(error);
  }
}
