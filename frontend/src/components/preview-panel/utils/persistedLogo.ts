import { fileToDataUrl } from "../../../utils/pdfAssets";

const PERSISTED_LOGO_MAX_EDGE = 900;
const PERSISTED_LOGO_QUALITY = 0.86;

export function loadPersistedLogo(
  key: string,
): { dataUrl: string; fileName: string } | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function savePersistedLogo(
  key: string,
  dataUrl: string,
  fileName: string,
): void {
  try {
    localStorage.setItem(key, JSON.stringify({ dataUrl, fileName }));
  } catch {}
}

export function clearPersistedLogo(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {}
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("No se pudo procesar la imagen"));
    img.src = dataUrl;
  });
}

/**
 * Comprime una imagen de logo para persistirla en localStorage
 * (webp, máx. 900px de lado). SVG y no-imágenes pasan sin tocar;
 * si la compresión no reduce tamaño o falla, se devuelve el original.
 */
export async function compressLogoForStorage(file: File): Promise<string> {
  const original = await fileToDataUrl(file);
  if (!file.type.startsWith("image/") || file.type === "image/svg+xml") {
    return original;
  }

  try {
    const img = await loadImage(original);
    const maxEdge = Math.max(img.naturalWidth, img.naturalHeight);
    const scale =
      maxEdge > PERSISTED_LOGO_MAX_EDGE ? PERSISTED_LOGO_MAX_EDGE / maxEdge : 1;
    const width = Math.max(1, Math.round(img.naturalWidth * scale));
    const height = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return original;
    ctx.drawImage(img, 0, 0, width, height);
    const compressed = canvas.toDataURL("image/webp", PERSISTED_LOGO_QUALITY);
    return compressed.length < original.length ? compressed : original;
  } catch {
    return original;
  }
}
