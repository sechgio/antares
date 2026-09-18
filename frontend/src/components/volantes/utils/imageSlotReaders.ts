import { toSlugId } from "./format";
import type { FlyerRecord } from "../types";

const LOGO_MAX_BYTES = 5 * 1024 * 1024;
const LOGO_ALLOWED_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/bmp",
]);

const imageReaders: Record<string, FileReader | null> = {
  logoIzquierdo: null,
  logoDerecho: null,
  logoOperativo: null,
  servicioAgua: null,
};

export function readImageAsDataUrl(
  slotKey: string,
  file: File,
  onError: (message: string) => void,
  onResult: (dataUrl: string) => void,
): void {
  if (!LOGO_ALLOWED_TYPES.has(file.type)) {
    onError("La imagen debe ser PNG, JPEG, WebP, GIF o BMP.");
    return;
  }
  if (file.size > LOGO_MAX_BYTES) {
    onError(
      `La imagen no puede superar 5 MB (recibido: ${(file.size / 1024 / 1024).toFixed(1)} MB).`,
    );
    return;
  }
  let reader = imageReaders[slotKey];
  if (reader) {
    try {
      reader.abort();
    } catch {}
  }
  reader = new FileReader();
  imageReaders[slotKey] = reader;
  reader.onload = () => {
    if (typeof reader.result === "string") onResult(reader.result);
    else onError("No se pudo leer la imagen.");
  };
  reader.onerror = () => onError("Error leyendo el archivo de imagen.");
  reader.readAsDataURL(file);
}

export function abortAllImageReaders(): void {
  for (const key of Object.keys(imageReaders)) {
    try {
      imageReaders[key]?.abort();
    } catch {}
    imageReaders[key] = null;
  }
}

export function createFlyerRecord(today: string): FlyerRecord {
  return {
    id: toSlugId(),
    distrito: "NUEVO DISTRITO",
    fecha: today,
    horaInicio: "08:00",
    horaFin: "16:00",
    reservorio: "NUEVO RESERVORIO",
    sector: "NUEVO SECTOR",
    zonasAfectadas: "Ingrese aqui el detalle de las zonas afectadas.",
  };
}

/** Tras borrar el registro seleccionado, la selección cae al primero restante. */
export function nextSelectedIdAfterDelete(
  remaining: FlyerRecord[],
  deletedId: string,
  selectedId: string | null,
): string | null {
  return selectedId === deletedId ? (remaining[0]?.id ?? null) : selectedId;
}
