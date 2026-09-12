import type { CanvasDocument, CanvasGuide } from '../types';
import { newId } from '../types';
import type { RectMm } from './selectionTransform';
import {
  boxesOverlapOnAxis,
  MIN_GUIDE_GAP_MM,
  measureSelectionGaps,
  type DistanceLabel,
} from './guideMeasurements';

export { measureHoverGap, measureSelectionGaps } from './guideMeasurements';
export type { DistanceLabel } from './guideMeasurements';

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

export function removeGuide(doc: CanvasDocument, id: string): CanvasDocument {
  return { ...doc, guides: (doc.guides ?? []).filter((g) => g.id !== id) };
}

export const GUIDE_REMOVE_SLACK_PX = 4;
const GAP_MATCH_TOLERANCE_MM = 0.1;

export function clampGuidePos(posMm: number, maxMm: number): number {
  return Math.max(0, Math.min(maxMm, posMm));
}

export function isGuideRemovalPoint(
  axis: 'x' | 'y',
  clientX: number,
  clientY: number,
  viewportRect: { left: number; top: number },
  rulerSize: number,
): boolean {
  if (axis === 'x') return clientX < viewportRect.left + rulerSize + GUIDE_REMOVE_SLACK_PX;
  return clientY < viewportRect.top + rulerSize + GUIDE_REMOVE_SLACK_PX;
}

export function collectReferenceGaps(
  others: RectMm[],
  page: { widthMm: number; heightMm: number },
): { x: number[]; y: number[] } {
  const xs = new Set<number>();
  const ys = new Set<number>();

  for (const o of others) {
    if (o.x > MIN_GUIDE_GAP_MM) xs.add(o.x);
    const rightGap = page.widthMm - (o.x + o.w);
    if (rightGap > MIN_GUIDE_GAP_MM) xs.add(rightGap);
    if (o.y > MIN_GUIDE_GAP_MM) ys.add(o.y);
    const bottomGap = page.heightMm - (o.y + o.h);
    if (bottomGap > MIN_GUIDE_GAP_MM) ys.add(bottomGap);
  }

  for (let i = 0; i < others.length; i++) {
    for (let j = 0; j < others.length; j++) {
      if (i === j) continue;
      const a = others[i]!;
      const b = others[j]!;
      if (boxesOverlapOnAxis(a.y, a.y + a.h, b.y, b.y + b.h)) {
        const gap = b.x - (a.x + a.w);
        if (gap > MIN_GUIDE_GAP_MM) xs.add(gap);
      }
      if (boxesOverlapOnAxis(a.x, a.x + a.w, b.x, b.x + b.w)) {
        const gap = b.y - (a.y + a.h);
        if (gap > MIN_GUIDE_GAP_MM) ys.add(gap);
      }
    }
  }

  return { x: [...xs], y: [...ys] };
}

export function snapEqualGaps(
  origin: RectMm,
  dxMm: number,
  dyMm: number,
  others: RectMm[],
  page: { widthMm: number; heightMm: number },
  thresholdMm: number,
  referenceGaps?: { x: number[]; y: number[] },
): { dx: number; dy: number; labels: DistanceLabel[] } {
  const refs = referenceGaps ?? collectReferenceGaps(others, page);
  const sel = { x: origin.x + dxMm, y: origin.y + dyMm, w: origin.w, h: origin.h };

  type Candidate = { dist: number; delta: number; label: DistanceLabel };
  const best: { x: Candidate | null; y: Candidate | null } = { x: null, y: null };

  const considerX = (currentGap: number, nextDx: number, label: DistanceLabel) => {
    if (currentGap <= MIN_GUIDE_GAP_MM) return;
    for (const g of refs.x) {
      const dist = Math.abs(currentGap - g);
      if (dist <= thresholdMm && (!best.x || dist < best.x.dist)) {
        const fromLeft = label.id.includes('left') || label.id.includes('page-left');
        best.x = {
          dist,
          delta: nextDx + (g - currentGap),
          label: fromLeft
            ? {
                ...label,
                valueMm: g,
                x: label.x1 + g / 2,
                x2: label.x1 + g,
              }
            : {
                ...label,
                valueMm: g,
                x: label.x2 - g / 2,
                x1: label.x2 - g,
              },
        };
      }
    }
  };

  const considerY = (currentGap: number, nextDy: number, label: DistanceLabel) => {
    if (currentGap <= MIN_GUIDE_GAP_MM) return;
    for (const g of refs.y) {
      const dist = Math.abs(currentGap - g);
      if (dist <= thresholdMm && (!best.y || dist < best.y.dist)) {
        if (label.id.includes('top') || label.id.includes('page-top')) {
          best.y = {
            dist,
            delta: nextDy + (g - currentGap),
            label: {
              ...label,
              valueMm: g,
              y: label.y1 + g / 2,
              y2: label.y1 + g,
            },
          };
        } else {
          best.y = {
            dist,
            delta: nextDy + (g - currentGap),
            label: {
              ...label,
              valueMm: g,
              y: label.y2 - g / 2,
              y1: label.y2 - g,
            },
          };
        }
      }
    }
  };

  const cx = sel.x + sel.w / 2;
  const cy = sel.y + sel.h / 2;

  considerX(sel.x, dxMm, {
    id: 'eq-page-left',
    axis: 'x',
    x: sel.x / 2,
    y: cy,
    valueMm: sel.x,
    x1: 0,
    y1: cy,
    x2: sel.x,
    y2: cy,
  });
  const toRight = page.widthMm - (sel.x + sel.w);
  considerX(toRight, dxMm, {
    id: 'eq-page-right',
    axis: 'x',
    x: sel.x + sel.w + toRight / 2,
    y: cy,
    valueMm: toRight,
    x1: sel.x + sel.w,
    y1: cy,
    x2: page.widthMm,
    y2: cy,
  });
  considerY(sel.y, dyMm, {
    id: 'eq-page-top',
    axis: 'y',
    x: cx,
    y: sel.y / 2,
    valueMm: sel.y,
    x1: cx,
    y1: 0,
    x2: cx,
    y2: sel.y,
  });
  const toBottom = page.heightMm - (sel.y + sel.h);
  considerY(toBottom, dyMm, {
    id: 'eq-page-bottom',
    axis: 'y',
    x: cx,
    y: sel.y + sel.h + toBottom / 2,
    valueMm: toBottom,
    x1: cx,
    y1: sel.y + sel.h,
    x2: cx,
    y2: page.heightMm,
  });

  for (const o of others) {
    if (boxesOverlapOnAxis(sel.y, sel.y + sel.h, o.y, o.y + o.h)) {
      const gapLeft = sel.x - (o.x + o.w);
      const midY = (Math.max(sel.y, o.y) + Math.min(sel.y + sel.h, o.y + o.h)) / 2;
      considerX(gapLeft, dxMm, {
        id: `eq-left-${Math.round(o.x)}`,
        axis: 'x',
        x: o.x + o.w + gapLeft / 2,
        y: midY,
        valueMm: gapLeft,
        x1: o.x + o.w,
        y1: midY,
        x2: sel.x,
        y2: midY,
      });
      const gapRight = o.x - (sel.x + sel.w);
      considerX(gapRight, dxMm, {
        id: `eq-right-${Math.round(o.x)}`,
        axis: 'x',
        x: sel.x + sel.w + gapRight / 2,
        y: midY,
        valueMm: gapRight,
        x1: sel.x + sel.w,
        y1: midY,
        x2: o.x,
        y2: midY,
      });
    }
    if (boxesOverlapOnAxis(sel.x, sel.x + sel.w, o.x, o.x + o.w)) {
      const gapTop = sel.y - (o.y + o.h);
      const midX = (Math.max(sel.x, o.x) + Math.min(sel.x + sel.w, o.x + o.w)) / 2;
      considerY(gapTop, dyMm, {
        id: `eq-top-${Math.round(o.y)}`,
        axis: 'y',
        x: midX,
        y: o.y + o.h + gapTop / 2,
        valueMm: gapTop,
        x1: midX,
        y1: o.y + o.h,
        x2: midX,
        y2: sel.y,
      });
      const gapBottom = o.y - (sel.y + sel.h);
      considerY(gapBottom, dyMm, {
        id: `eq-bottom-${Math.round(o.y)}`,
        axis: 'y',
        x: midX,
        y: sel.y + sel.h + gapBottom / 2,
        valueMm: gapBottom,
        x1: midX,
        y1: sel.y + sel.h,
        x2: midX,
        y2: o.y,
      });
    }
  }

  const labels: DistanceLabel[] = [];
  const dx = best.x ? best.x.delta : dxMm;
  const dy = best.y ? best.y.delta : dyMm;

  if (best.x || best.y) {
    const snappedSel = { x: origin.x + dx, y: origin.y + dy, w: origin.w, h: origin.h };
    const measured = measureSelectionGaps(snappedSel, others, page);
    const addedIds = new Set<string>();

    if (best.x) {
      const targetVal = best.x.label.valueMm;
      const matching = measured.filter(
        (l) => l.axis === 'x' && Math.abs(l.valueMm - targetVal) < GAP_MATCH_TOLERANCE_MM,
      );
      if (matching.length) {
        for (const m of matching) {
          labels.push(m);
          addedIds.add(m.id);
        }
      } else {
        labels.push(best.x.label);
        addedIds.add(best.x.label.id);
      }
    }

    if (best.y) {
      const targetVal = best.y.label.valueMm;
      const matching = measured.filter(
        (l) => l.axis === 'y' && Math.abs(l.valueMm - targetVal) < GAP_MATCH_TOLERANCE_MM,
      );
      if (matching.length) {
        for (const m of matching) {
          if (!addedIds.has(m.id)) {
            labels.push(m);
            addedIds.add(m.id);
          }
        }
      } else if (!addedIds.has(best.y.label.id)) {
        labels.push(best.y.label);
      }
    }
  }

  return { dx, dy, labels };
}

function formatMmNumber(valueMm: number): string {
  const rounded = Math.round(valueMm * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}` : rounded.toFixed(1);
}

export function formatGapMm(valueMm: number): string {
  return `${formatMmNumber(valueMm)} mm`;
}

export function formatSizeMm(wMm: number, hMm: number): string {
  return `${formatMmNumber(wMm)} × ${formatMmNumber(hMm)}`;
}
