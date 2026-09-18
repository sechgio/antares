import { chunkArray } from "../constants";
import type { PhotoFile } from "../types";

export const MIN_SIDEBAR_WIDTH = 220;
export const MAX_SIDEBAR_WIDTH = 400;
export const DEFAULT_SIDEBAR_WIDTH = 264;

/** Ancho de sidebar clamped tras un arrastre; el lado derecho invierte el delta. */
export function clampedSidebarWidth(
  startWidth: number,
  clientDelta: number,
  side: "left" | "right",
): number {
  const widthDelta = side === "left" ? clientDelta : -clientDelta;
  return Math.max(
    MIN_SIDEBAR_WIDTH,
    Math.min(MAX_SIDEBAR_WIDTH, startWidth + widthDelta),
  );
}

/** Paginación del grid de fotos; siempre devuelve al menos una página vacía. */
export function paginatePhotos(
  photos: PhotoFile[],
  itemsPerPage: number,
): { chunks: PhotoFile[][]; totalPages: number } {
  const chunked = chunkArray(photos, itemsPerPage);
  const chunks = chunked.length > 0 ? chunked : [[]];
  return { chunks, totalPages: chunks.length };
}

/** Página actual válida tras cambios en el total (p. ej. al borrar fotos). */
export function clampCurrentPage(page: number, totalPages: number): number {
  return page >= totalPages ? Math.max(0, totalPages - 1) : page;
}

/** Texto de estado para el botón de exportación consolidada. */
export function exportablePanelStatus(count: number): string {
  if (count === 0) return "Sin fotos";
  return `${count} panel${count === 1 ? "" : "es"} listo${count === 1 ? "" : "s"}`;
}
