import type { CanvasDocument, CanvasGuide } from '../types';
import { newId } from '../types';
import type { RectMm } from './selectionTransform';
import {
  boxesOverlapOnAxis,
  MIN_GUIDE_GAP_MM,
  measureSelectionGaps,
  type DistanceLabel,
} from './guideMeasurements';

export { measureGuideDistances, measureHoverGap, measureSelectionGaps } from './guideMeasurements';
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

export function clearGuides(doc: CanvasDocument): CanvasDocument {
  return (doc.guides ?? []).length ? { ...doc, guides: [] } : doc;
}

const GUIDE_REMOVE_SLACK_PX = 4;
const GAP_MATCH_TOLERANCE_MM = 0.1;

type ReferenceGaps = { x: number[]; y: number[] };
type OrderedReferenceGaps = { x: Uint32Array; y: Uint32Array };
type GapAxis = 'x' | 'y';

const orderedReferenceGapsCache = new WeakMap<ReferenceGaps, OrderedReferenceGaps>();

function getOrderedReferenceGaps(referenceGaps: ReferenceGaps): OrderedReferenceGaps {
  const cached = orderedReferenceGapsCache.get(referenceGaps);
  if (cached) return cached;

  const order = (gaps: number[]) =>
    Uint32Array.from({ length: gaps.length }, (_, index) => index).sort(
      (left, right) => gaps[left]! - gaps[right]! || left - right,
    );
  const ordered = { x: order(referenceGaps.x), y: order(referenceGaps.y) };
  orderedReferenceGapsCache.set(referenceGaps, ordered);
  return ordered;
}

function lowerBoundGap(gaps: number[], ordered: Uint32Array, value: number): number {
  let low = 0;
  let high = ordered.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (gaps[ordered[middle]!]! < value) low = middle + 1;
    else high = middle;
  }
  return low;
}

function nearestReferenceGapIndex(gaps: number[], ordered: Uint32Array, value: number): number {
  if (!ordered.length) return -1;
  const insertion = lowerBoundGap(gaps, ordered, value);
  let before = insertion > 0 ? ordered[insertion - 1]! : -1;
  const after = insertion < ordered.length ? ordered[insertion]! : -1;
  if (before < 0) return after;
  if (after < 0) return ordered[lowerBoundGap(gaps, ordered, gaps[before]!)]!;

  const beforeValue = gaps[before]!;
  before = ordered[lowerBoundGap(gaps, ordered, beforeValue)]!;
  const beforeDistance = Math.abs(value - beforeValue);
  const afterDistance = Math.abs(value - gaps[after]!);
  if (beforeDistance < afterDistance) return before;
  if (afterDistance < beforeDistance) return after;
  return Math.min(before, after);
}

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

function collectOverlappingPairGaps(
  others: RectMm[],
  overlapAxis: GapAxis,
  gapAxis: GapAxis,
): number[] {
  const intervals = others.flatMap((rect, index) => {
    const start = overlapAxis === 'x' ? rect.x : rect.y;
    const end = start + (overlapAxis === 'x' ? rect.w : rect.h);
    return end > start ? [{ rect, index, start, end }] : [];
  });
  intervals.sort((a, b) => a.start - b.start || a.index - b.index);

  if (intervals.length === others.length && intervals.length > 1) {
    const first = intervals[0]!;
    const second = intervals[1]!;
    const firstGapStart = gapAxis === 'x' ? first.rect.x : first.rect.y;
    const firstGapSize = gapAxis === 'x' ? first.rect.w : first.rect.h;
    const gapStep =
      (gapAxis === 'x' ? second.rect.x : second.rect.y) - firstGapStart;
    let regularlySpaced = gapStep !== 0;

    for (let i = 0; regularlySpaced && i < intervals.length; i += 1) {
      const interval = intervals[i]!;
      const gapStart = gapAxis === 'x' ? interval.rect.x : interval.rect.y;
      const gapSize = gapAxis === 'x' ? interval.rect.w : interval.rect.h;
      regularlySpaced =
        interval.start === first.start &&
        interval.end === first.end &&
        gapSize === firstGapSize &&
        gapStart === firstGapStart + gapStep * i;
    }

    if (regularlySpaced) {
      const gaps: number[] = [];
      const step = Math.abs(gapStep);
      for (let distance = 1; distance < intervals.length; distance += 1) {
        const gap = step * distance - firstGapSize;
        if (gap > MIN_GUIDE_GAP_MM) gaps.push(gap);
      }
      return gaps;
    }
  }

  const active: typeof intervals = [];
  const orderedGaps = new Map<number, number>();
  const addGap = (gap: number, order: number) => {
    if (gap <= MIN_GUIDE_GAP_MM) return;
    const previousOrder = orderedGaps.get(gap);
    if (previousOrder === undefined || order < previousOrder) orderedGaps.set(gap, order);
  };

  for (const current of intervals) {
    for (let i = active.length - 1; i >= 0; i--) {
      const previous = active[i]!;
      if (previous.end <= current.start) {
        active.splice(i, 1);
        continue;
      }

      const previousStart = gapAxis === 'x' ? previous.rect.x : previous.rect.y;
      const previousSize = gapAxis === 'x' ? previous.rect.w : previous.rect.h;
      const currentStart = gapAxis === 'x' ? current.rect.x : current.rect.y;
      const currentSize = gapAxis === 'x' ? current.rect.w : current.rect.h;
      addGap(currentStart - (previousStart + previousSize), previous.index * others.length + current.index);
      addGap(previousStart - (currentStart + currentSize), current.index * others.length + previous.index);
    }
    active.push(current);
  }

  return [...orderedGaps]
    .sort((left, right) => left[1] - right[1])
    .map(([gap]) => gap);
}

export function collectReferenceGaps(
  others: RectMm[],
  page: { widthMm: number; heightMm: number },
): ReferenceGaps {
  const xs = new Set<number>();
  const ys = new Set<number>();
  const seen = new Set<string>();
  const uniqueOthers: RectMm[] = [];

  for (const other of others) {
    const key = `${other.x},${other.y},${other.w},${other.h}`;
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueOthers.push(other);
  }

  for (const o of uniqueOthers) {
    if (o.x > MIN_GUIDE_GAP_MM) xs.add(o.x);
    const rightGap = page.widthMm - (o.x + o.w);
    if (rightGap > MIN_GUIDE_GAP_MM) xs.add(rightGap);
    if (o.y > MIN_GUIDE_GAP_MM) ys.add(o.y);
    const bottomGap = page.heightMm - (o.y + o.h);
    if (bottomGap > MIN_GUIDE_GAP_MM) ys.add(bottomGap);
  }

  for (const gap of collectOverlappingPairGaps(uniqueOthers, 'y', 'x')) xs.add(gap);
  for (const gap of collectOverlappingPairGaps(uniqueOthers, 'x', 'y')) ys.add(gap);

  return { x: [...xs], y: [...ys] };
}

export function snapEqualGaps(
  origin: RectMm,
  dxMm: number,
  dyMm: number,
  others: RectMm[],
  page: { widthMm: number; heightMm: number },
  thresholdMm: number,
  referenceGaps?: ReferenceGaps,
): { dx: number; dy: number; labels: DistanceLabel[] } {
  const refs = referenceGaps ?? collectReferenceGaps(others, page);
  const orderedRefs = getOrderedReferenceGaps(refs);
  const sel = { x: origin.x + dxMm, y: origin.y + dyMm, w: origin.w, h: origin.h };

  type Candidate = { dist: number; delta: number; label: DistanceLabel };
  const best: { x: Candidate | null; y: Candidate | null } = { x: null, y: null };

  const considerX = (currentGap: number, nextDx: number, label: DistanceLabel) => {
    if (currentGap <= MIN_GUIDE_GAP_MM) return;
    const referenceIndex = nearestReferenceGapIndex(refs.x, orderedRefs.x, currentGap);
    if (referenceIndex < 0) return;
    const g = refs.x[referenceIndex]!;
    const dist = Math.abs(currentGap - g);
    if (!(dist <= thresholdMm) || (best.x && dist >= best.x.dist)) return;
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
  };

  const considerY = (currentGap: number, nextDy: number, label: DistanceLabel) => {
    if (currentGap <= MIN_GUIDE_GAP_MM) return;
    const referenceIndex = nearestReferenceGapIndex(refs.y, orderedRefs.y, currentGap);
    if (referenceIndex < 0) return;
    const g = refs.y[referenceIndex]!;
    const dist = Math.abs(currentGap - g);
    if (!(dist <= thresholdMm) || (best.y && dist >= best.y.dist)) return;
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
