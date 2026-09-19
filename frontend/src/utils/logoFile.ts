import { fileToDataUrl } from './pdfAssets';

/**
 * Selección de logo compartida: con `file` nulo limpia el estado; si no, lee
 * el archivo como data URL y lo entrega al `apply` del llamador; los errores
 * de lectura van a `onError`.
 */
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
