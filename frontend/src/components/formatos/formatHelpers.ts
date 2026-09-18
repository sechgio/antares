import { api } from "../../api";
import { safeBase64ToBytes } from "./base64";
import type { FormatInfo } from "../../types";

export const MAX_PREVIEW_PAGES = 30;
export const ZOOM_MIN = 25;
export const ZOOM_MAX = 300;

export function pad(n: number, len = 7): string {
  return String(n).padStart(len, "0");
}

export function isPdfFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return name.endsWith(".pdf") || file.type === "application/pdf";
}

export function clampZoom(v: number): number {
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(v)));
}

export function buildGeneratedPdfName(
  selected: FormatInfo,
  desde: number,
  hasta: number,
): string {
  const p = selected.mapping?.padding ?? 7;
  const desdeS = pad(desde, p);
  const hastaS = pad(hasta, p);
  return desde === hasta
    ? `${selected.id}_${desdeS}.pdf`
    : `${selected.id}_${desdeS}-${hastaS}.pdf`;
}

/** Valida que el rango sea generable y que la estrategia soporte preview. */
export function formatCanPreview(
  format: FormatInfo,
  desde: number,
  hasta: number,
): boolean {
  const total = Math.max(0, hasta - desde + 1);
  const maxPages = format.max_pages ?? 500;
  const numMin = format.number_min ?? 1;
  const numMax = format.number_max ?? 9999999;
  const isValid =
    desde >= numMin && hasta >= desde && total <= maxPages && hasta <= numMax;
  return (
    isValid &&
    (format.strategy === "legacy_xobject" ||
      format.strategy === "simple_overlay" ||
      format.has_mapping)
  );
}

export async function fetchPreviewPdf(
  formatId: string,
  desde: number,
  hasta: number,
) {
  const previewTotal = hasta - desde + 1;
  const previewHasta = Math.min(hasta, desde + MAX_PREVIEW_PAGES - 1);
  const res = await api.formatosGenerate({
    format_id: formatId,
    desde,
    hasta: previewHasta,
  });
  if (!res.pdf_base64)
    throw new Error("No se recibio el contenido de vista previa.");
  const binary = safeBase64ToBytes(res.pdf_base64);
  return {
    blob: new Blob([binary], { type: "application/pdf" }),
    previewDesde: desde,
    previewTotal,
  };
}
