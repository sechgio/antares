import type { CanvasDocument, CanvasGuide } from '../types';
import { newId } from '../types';
import type { RectMm } from './selectionTransform';

export type DistanceLabel = {
  id: string;
  axis: 'x' | 'y';
  /** Label anchor in page mm */
  x: number;
  y: number;
  /** Measured gap in mm */
  valueMm: number;
  /** Line endpoints in page mm */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

export function createGuide(axis: 'x' | 'y', posMm: number, pageIndex = 0): CanvasGuide {
  return { id: newId(), axis, posMm, pageIndex };
}

export function guidesForPage(doc: CanvasDocument, pageIndex: number): CanvasGuide[] {
  return (doc.guides ?? []).filter((g) => (g.pageIndex ?? 0) === pageIndex);
}

export function upsertGuide(doc: CanvasDocument, guide: CanvasGuide): CanvasDocument {
  const guides = [...(doc.guides ?? [])];
  const idx = guides.findIndex((g) => g.id === guide.id);
  if (idx >= 0) guides[idx] = guide;
  else guides.push(guide);
  return { ...doc, guides };
}

export function moveGuide(doc: CanvasDocument, id: string, posMm: number): CanvasDocument {
  const guides = (doc.guides ?? []).map((g) => (g.id === id ? { ...g, posMm } : g));
  return { ...doc, guides };
}

/** Remove a guide, or drop it when dragged back into the ruler margin. */
export function removeGuide(doc: CanvasDocument, id: string): CanvasDocument {
  return { ...doc, guides: (doc.guides ?? []).filter((g) => g.id !== id) };
}

/**
 * Gap labels from selection AABB to nearest sibling edges / page edges.
 * Used for Alt-hold distance readout while dragging.
 */
export function measureSelectionGaps(
  selection: RectMm,
  others: RectMm[],
  page: { widthMm: number; heightMm: number },
): DistanceLabel[] {
  const labels: DistanceLabel[] = [];
  const cx = selection.x + selection.w / 2;
  const cy = selection.y + selection.h / 2;

  // Page edges
  const toLeft = selection.x;
  const toRight = page.widthMm - (selection.x + selection.w);
  const toTop = selection.y;
  const toBottom = page.heightMm - (selection.y + selection.h);

  if (toLeft > 0.05) {
    labels.push({
      id: 'page-left',
      axis: 'x',
      x: selection.x / 2,
      y: cy,
      valueMm: toLeft,
      x1: 0,
      y1: cy,
      x2: selection.x,
      y2: cy,
    });
  }
  if (toRight > 0.05) {
    labels.push({
      id: 'page-right',
      axis: 'x',
      x: selection.x + selection.w + toRight / 2,
      y: cy,
      valueMm: toRight,
      x1: selection.x + selection.w,
      y1: cy,
      x2: page.widthMm,
      y2: cy,
    });
  }
  if (toTop > 0.05) {
    labels.push({
      id: 'page-top',
      axis: 'y',
      x: cx,
      y: selection.y / 2,
      valueMm: toTop,
      x1: cx,
      y1: 0,
      x2: cx,
      y2: selection.y,
    });
  }
  if (toBottom > 0.05) {
    labels.push({
      id: 'page-bottom',
      axis: 'y',
      x: cx,
      y: selection.y + selection.h + toBottom / 2,
      valueMm: toBottom,
      x1: cx,
      y1: selection.y + selection.h,
      x2: cx,
      y2: page.heightMm,
    });
  }

  // Nearest horizontal gaps to other boxes (left/right)
  let bestLeft: { dist: number; other: RectMm } | null = null;
  let bestRight: { dist: number; other: RectMm } | null = null;
  let bestTop: { dist: number; other: RectMm } | null = null;
  let bestBottom: { dist: number; other: RectMm } | null = null;

  for (const o of others) {
    const gapLeft = selection.x - (o.x + o.w);
    if (gapLeft > 0.05 && (!bestLeft || gapLeft < bestLeft.dist)) {
      bestLeft = { dist: gapLeft, other: o };
    }
    const gapRight = o.x - (selection.x + selection.w);
    if (gapRight > 0.05 && (!bestRight || gapRight < bestRight.dist)) {
      bestRight = { dist: gapRight, other: o };
    }
    const gapTop = selection.y - (o.y + o.h);
    if (gapTop > 0.05 && (!bestTop || gapTop < bestTop.dist)) {
      bestTop = { dist: gapTop, other: o };
    }
    const gapBottom = o.y - (selection.y + selection.h);
    if (gapBottom > 0.05 && (!bestBottom || gapBottom < bestBottom.dist)) {
      bestBottom = { dist: gapBottom, other: o };
    }
  }

  if (bestLeft) {
    const o = bestLeft.other;
    const midY = (Math.max(selection.y, o.y) + Math.min(selection.y + selection.h, o.y + o.h)) / 2;
    labels.push({
      id: 'obj-left',
      axis: 'x',
      x: o.x + o.w + bestLeft.dist / 2,
      y: midY,
      valueMm: bestLeft.dist,
      x1: o.x + o.w,
      y1: midY,
      x2: selection.x,
      y2: midY,
    });
  }
  if (bestRight) {
    const o = bestRight.other;
    const midY = (Math.max(selection.y, o.y) + Math.min(selection.y + selection.h, o.y + o.h)) / 2;
    labels.push({
      id: 'obj-right',
      axis: 'x',
      x: selection.x + selection.w + bestRight.dist / 2,
      y: midY,
      valueMm: bestRight.dist,
      x1: selection.x + selection.w,
      y1: midY,
      x2: o.x,
      y2: midY,
    });
  }
  if (bestTop) {
    const o = bestTop.other;
    const midX = (Math.max(selection.x, o.x) + Math.min(selection.x + selection.w, o.x + o.w)) / 2;
    labels.push({
      id: 'obj-top',
      axis: 'y',
      x: midX,
      y: o.y + o.h + bestTop.dist / 2,
      valueMm: bestTop.dist,
      x1: midX,
      y1: o.y + o.h,
      x2: midX,
      y2: selection.y,
    });
  }
  if (bestBottom) {
    const o = bestBottom.other;
    const midX = (Math.max(selection.x, o.x) + Math.min(selection.x + selection.w, o.x + o.w)) / 2;
    labels.push({
      id: 'obj-bottom',
      axis: 'y',
      x: midX,
      y: selection.y + selection.h + bestBottom.dist / 2,
      valueMm: bestBottom.dist,
      x1: midX,
      y1: selection.y + selection.h,
      x2: midX,
      y2: o.y,
    });
  }

  return labels;
}

/** Format mm for distance chips (1 decimal when needed). */
export function formatGapMm(valueMm: number): string {
  const rounded = Math.round(valueMm * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded} mm` : `${rounded.toFixed(1)} mm`;
}
