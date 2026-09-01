import type { PdfBox, PdfMatrix } from './pdfImportTypes';

const POINTS_PER_INCH = 72;
const MM_PER_INCH = 25.4;
const EPSILON = 1e-6;

export interface CanvasBox {
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
}

export interface TransformedPdfBounds {
  box: PdfBox;
  rotationDeg: number;
  scaleX: number;
  scaleY: number;
}

export function pdfPointsToMm(points: number): number {
  return (points * MM_PER_INCH) / POINTS_PER_INCH;
}

export function pdfBoxToCanvasBox(
  box: PdfBox,
  page: { widthPt: number; heightPt: number },
): CanvasBox {
  return {
    xMm: pdfPointsToMm(box.x),
    yMm: pdfPointsToMm(page.heightPt - box.y - box.height),
    widthMm: pdfPointsToMm(box.width),
    heightMm: pdfPointsToMm(box.height),
  };
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function byteHex(value: number): string {
  return Math.round(clampUnit(value) * 255)
    .toString(16)
    .padStart(2, '0')
    .toUpperCase();
}

/** Convert PDF.js RGB/gray color values into the Canvas color format. */
export function parsePdfColor(value: unknown, fallback?: string): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || fallback;
  }
  if (Array.isArray(value)) {
    if (value.length >= 3) {
      return `#${byteHex(Number(value[0]))}${byteHex(Number(value[1]))}${byteHex(Number(value[2]))}`;
    }
    if (value.length === 1) {
      const gray = byteHex(Number(value[0]));
      return `#${gray}${gray}${gray}`;
    }
  }
  if (value && typeof value === 'object') {
    const candidate = value as { r?: unknown; g?: unknown; b?: unknown };
    if (candidate.r !== undefined && candidate.g !== undefined && candidate.b !== undefined) {
      return `#${byteHex(Number(candidate.r))}${byteHex(Number(candidate.g))}${byteHex(Number(candidate.b))}`;
    }
  }
  return fallback;
}

export function normalizeRotationDeg(degrees: number): number {
  if (!Number.isFinite(degrees)) return 0;
  let normalized = degrees % 360;
  if (normalized > 180) normalized -= 360;
  if (normalized <= -180) normalized += 360;
  if (Math.abs(normalized) < EPSILON) return 0;
  return normalized;
}

function transformPoint(matrix: PdfMatrix, x: number, y: number): { x: number; y: number } {
  return {
    x: matrix.a * x + matrix.c * y + matrix.e,
    y: matrix.b * x + matrix.d * y + matrix.f,
  };
}

/**
 * Return an axis-aligned box plus CSS-compatible scale/rotation for an affine
 * rectangle transform. Shear and non-orthogonal transforms are intentionally
 * rejected because representing them with Canvas cssVars would distort edits.
 */
export function transformedBounds(box: PdfBox, matrix: PdfMatrix): TransformedPdfBounds | null {
  const scaleX = Math.hypot(matrix.a, matrix.b);
  const scaleY = Math.hypot(matrix.c, matrix.d);
  if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY) || scaleX < EPSILON || scaleY < EPSILON) {
    return null;
  }

  const dot = matrix.a * matrix.c + matrix.b * matrix.d;
  if (Math.abs(dot) > EPSILON * Math.max(1, scaleX * scaleY)) return null;

  const points = [
    transformPoint(matrix, box.x, box.y),
    transformPoint(matrix, box.x + box.width, box.y),
    transformPoint(matrix, box.x + box.width, box.y + box.height),
    transformPoint(matrix, box.x, box.y + box.height),
  ];
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
  return {
    box: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
    rotationDeg: normalizeRotationDeg((Math.atan2(matrix.b, matrix.a) * 180) / Math.PI),
    scaleX,
    scaleY: determinant < 0 ? -scaleY : scaleY,
  };
}
