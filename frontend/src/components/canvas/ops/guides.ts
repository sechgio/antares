import type { CanvasDocument, CanvasGuide } from '../types';
import { newId } from '../types';
import type { RectMm } from './selectionTransform';

export type DistanceLabel = {
  id: string;
  axis: 'x' | 'y';
  x: number;
  y: number;
  valueMm: number;
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

export function removeGuide(doc: CanvasDocument, id: string): CanvasDocument {
  return { ...doc, guides: (doc.guides ?? []).filter((g) => g.id !== id) };
}

export const GUIDE_REMOVE_SLACK_PX = 4;

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

export function measureSelectionGaps(
  selection: RectMm,
  others: RectMm[],
  page: { widthMm: number; heightMm: number },
): DistanceLabel[] {
  const labels: DistanceLabel[] = [];
  const cx = selection.x + selection.w / 2;
  const cy = selection.y + selection.h / 2;

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

  const horizBoxes = [
    selection,
    ...others.filter((o) => boxesOverlapOnAxis(selection.y, selection.y + selection.h, o.y, o.y + o.h)),
  ].sort((a, b) => a.x - b.x);

  for (let i = 0; i < horizBoxes.length - 1; i++) {
    const a = horizBoxes[i];
    const b = horizBoxes[i + 1];
    const gap = b.x - (a.x + a.w);
    if (gap > 0.05) {
      const midY = (Math.max(a.y, b.y) + Math.min(a.y + a.h, b.y + b.h)) / 2;
      const isSelPair = a === selection || b === selection;
      labels.push({
        id: isSelPair
          ? a === selection
            ? 'obj-right'
            : 'obj-left'
          : `obj-x-${Math.round(a.x)}-${Math.round(b.x)}`,
        axis: 'x',
        x: a.x + a.w + gap / 2,
        y: midY,
        valueMm: gap,
        x1: a.x + a.w,
        y1: midY,
        x2: b.x,
        y2: midY,
      });
    }
  }

  const vertBoxes = [
    selection,
    ...others.filter((o) => boxesOverlapOnAxis(selection.x, selection.x + selection.w, o.x, o.x + o.w)),
  ].sort((a, b) => a.y - b.y);

  for (let i = 0; i < vertBoxes.length - 1; i++) {
    const a = vertBoxes[i];
    const b = vertBoxes[i + 1];
    const gap = b.y - (a.y + a.h);
    if (gap > 0.05) {
      const midX = (Math.max(a.x, b.x) + Math.min(a.x + a.w, b.x + b.w)) / 2;
      const isSelPair = a === selection || b === selection;
      labels.push({
        id: isSelPair
          ? a === selection
            ? 'obj-bottom'
            : 'obj-top'
          : `obj-y-${Math.round(a.y)}-${Math.round(b.y)}`,
        axis: 'y',
        x: midX,
        y: a.y + a.h + gap / 2,
        valueMm: gap,
        x1: midX,
        y1: a.y + a.h,
        x2: midX,
        y2: b.y,
      });
    }
  }

  return labels;
}

function boxesOverlapOnAxis(
  a0: number,
  a1: number,
  b0: number,
  b1: number,
): boolean {
  return Math.max(a0, b0) < Math.min(a1, b1);
}

export function collectReferenceGaps(
  others: RectMm[],
  page: { widthMm: number; heightMm: number },
): { x: number[]; y: number[] } {
  const xs = new Set<number>();
  const ys = new Set<number>();

  for (const o of others) {
    if (o.x > 0.05) xs.add(o.x);
    const rightGap = page.widthMm - (o.x + o.w);
    if (rightGap > 0.05) xs.add(rightGap);
    if (o.y > 0.05) ys.add(o.y);
    const bottomGap = page.heightMm - (o.y + o.h);
    if (bottomGap > 0.05) ys.add(bottomGap);
  }

  for (let i = 0; i < others.length; i++) {
    for (let j = 0; j < others.length; j++) {
      if (i === j) continue;
      const a = others[i]!;
      const b = others[j]!;
      if (boxesOverlapOnAxis(a.y, a.y + a.h, b.y, b.y + b.h)) {
        const gap = b.x - (a.x + a.w);
        if (gap > 0.05) xs.add(gap);
      }
      if (boxesOverlapOnAxis(a.x, a.x + a.w, b.x, b.x + b.w)) {
        const gap = b.y - (a.y + a.h);
        if (gap > 0.05) ys.add(gap);
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
    if (currentGap <= 0.05) return;
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
    if (currentGap <= 0.05) return;
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
        (l) => l.axis === 'x' && Math.abs(l.valueMm - targetVal) < 0.1,
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
        (l) => l.axis === 'y' && Math.abs(l.valueMm - targetVal) < 0.1,
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
