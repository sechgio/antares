import type { RectMm } from './selectionTransform';

export const MIN_GUIDE_GAP_MM = 0.05;

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

export function boxesOverlapOnAxis(a0: number, a1: number, b0: number, b1: number): boolean {
  return Math.max(a0, b0) < Math.min(a1, b1);
}

export function measureSelectionGaps(
  selection: RectMm,
  others: RectMm[],
  page: { widthMm: number; heightMm: number },
): DistanceLabel[] {
  const labels: DistanceLabel[] = [];
  const centerX = selection.x + selection.w / 2;
  const centerY = selection.y + selection.h / 2;
  const pageGaps = {
    left: selection.x,
    right: page.widthMm - selection.x - selection.w,
    top: selection.y,
    bottom: page.heightMm - selection.y - selection.h,
  };

  if (pageGaps.left > MIN_GUIDE_GAP_MM) {
    labels.push({
      id: 'page-left',
      axis: 'x',
      x: selection.x / 2,
      y: centerY,
      valueMm: pageGaps.left,
      x1: 0,
      y1: centerY,
      x2: selection.x,
      y2: centerY,
    });
  }
  if (pageGaps.right > MIN_GUIDE_GAP_MM) {
    labels.push({
      id: 'page-right',
      axis: 'x',
      x: selection.x + selection.w + pageGaps.right / 2,
      y: centerY,
      valueMm: pageGaps.right,
      x1: selection.x + selection.w,
      y1: centerY,
      x2: page.widthMm,
      y2: centerY,
    });
  }
  if (pageGaps.top > MIN_GUIDE_GAP_MM) {
    labels.push({
      id: 'page-top',
      axis: 'y',
      x: centerX,
      y: selection.y / 2,
      valueMm: pageGaps.top,
      x1: centerX,
      y1: 0,
      x2: centerX,
      y2: selection.y,
    });
  }
  if (pageGaps.bottom > MIN_GUIDE_GAP_MM) {
    labels.push({
      id: 'page-bottom',
      axis: 'y',
      x: centerX,
      y: selection.y + selection.h + pageGaps.bottom / 2,
      valueMm: pageGaps.bottom,
      x1: centerX,
      y1: selection.y + selection.h,
      x2: centerX,
      y2: page.heightMm,
    });
  }

  const horizontalBoxes = [
    selection,
    ...others.filter((box) =>
      boxesOverlapOnAxis(selection.y, selection.y + selection.h, box.y, box.y + box.h),
    ),
  ].sort((left, right) => left.x - right.x);

  for (let index = 0; index < horizontalBoxes.length - 1; index += 1) {
    const left = horizontalBoxes[index]!;
    const right = horizontalBoxes[index + 1]!;
    const gap = right.x - left.x - left.w;
    if (gap <= MIN_GUIDE_GAP_MM) continue;

    const y = (Math.max(left.y, right.y) + Math.min(left.y + left.h, right.y + right.h)) / 2;
    labels.push({
      id:
        left === selection
          ? 'obj-right'
          : right === selection
            ? 'obj-left'
            : `obj-x-${Math.round(left.x)}-${Math.round(right.x)}`,
      axis: 'x',
      x: left.x + left.w + gap / 2,
      y,
      valueMm: gap,
      x1: left.x + left.w,
      y1: y,
      x2: right.x,
      y2: y,
    });
  }

  const verticalBoxes = [
    selection,
    ...others.filter((box) =>
      boxesOverlapOnAxis(selection.x, selection.x + selection.w, box.x, box.x + box.w),
    ),
  ].sort((top, bottom) => top.y - bottom.y);

  for (let index = 0; index < verticalBoxes.length - 1; index += 1) {
    const top = verticalBoxes[index]!;
    const bottom = verticalBoxes[index + 1]!;
    const gap = bottom.y - top.y - top.h;
    if (gap <= MIN_GUIDE_GAP_MM) continue;

    const x = (Math.max(top.x, bottom.x) + Math.min(top.x + top.w, bottom.x + bottom.w)) / 2;
    labels.push({
      id:
        top === selection
          ? 'obj-bottom'
          : bottom === selection
            ? 'obj-top'
            : `obj-y-${Math.round(top.y)}-${Math.round(bottom.y)}`,
      axis: 'y',
      x,
      y: top.y + top.h + gap / 2,
      valueMm: gap,
      x1: x,
      y1: top.y + top.h,
      x2: x,
      y2: bottom.y,
    });
  }

  return labels;
}

export function measureHoverGap(
  selection: RectMm,
  target: RectMm | null,
  page: { widthMm: number; heightMm: number },
): DistanceLabel[] {
  if (!target) return measureSelectionGaps(selection, [], page);
  const labels: DistanceLabel[] = [];
  const separatedX = selection.x + selection.w <= target.x || target.x + target.w <= selection.x;
  const separatedY = selection.y + selection.h <= target.y || target.y + target.h <= selection.y;
  const overlapCenterX =
    (Math.max(selection.x, target.x) + Math.min(selection.x + selection.w, target.x + target.w)) / 2;
  const overlapCenterY =
    (Math.max(selection.y, target.y) + Math.min(selection.y + selection.h, target.y + target.h)) / 2;
  const centerX = separatedX
    ? (Math.min(selection.x, target.x) + Math.max(selection.x + selection.w, target.x + target.w)) / 2
    : overlapCenterX;
  const centerY = separatedY
    ? (Math.min(selection.y, target.y) + Math.max(selection.y + selection.h, target.y + target.h)) / 2
    : overlapCenterY;

  if (separatedX) {
    const targetIsRight = target.x >= selection.x + selection.w;
    const gap = targetIsRight
      ? target.x - selection.x - selection.w
      : selection.x - target.x - target.w;
    if (gap > MIN_GUIDE_GAP_MM) {
      const x1 = targetIsRight ? selection.x + selection.w : target.x + target.w;
      const x2 = targetIsRight ? target.x : selection.x;
      labels.push({
        id: 'hover-x',
        axis: 'x',
        x: (x1 + x2) / 2,
        y: centerY,
        valueMm: gap,
        x1,
        y1: centerY,
        x2,
        y2: centerY,
      });
    }
  } else {
    const leftDelta = target.x - selection.x;
    if (Math.abs(leftDelta) > MIN_GUIDE_GAP_MM) {
      const x1 = Math.min(selection.x, target.x);
      const x2 = Math.max(selection.x, target.x);
      labels.push({
        id: 'hover-x-left',
        axis: 'x',
        x: (x1 + x2) / 2,
        y: centerY,
        valueMm: Math.abs(leftDelta),
        x1,
        y1: centerY,
        x2,
        y2: centerY,
      });
    }
    const rightDelta = target.x + target.w - selection.x - selection.w;
    if (Math.abs(rightDelta) > MIN_GUIDE_GAP_MM) {
      const x1 = Math.min(selection.x + selection.w, target.x + target.w);
      const x2 = Math.max(selection.x + selection.w, target.x + target.w);
      labels.push({
        id: 'hover-x-right',
        axis: 'x',
        x: (x1 + x2) / 2,
        y: centerY,
        valueMm: Math.abs(rightDelta),
        x1,
        y1: centerY,
        x2,
        y2: centerY,
      });
    }
  }

  if (separatedY) {
    const targetIsBelow = target.y >= selection.y + selection.h;
    const gap = targetIsBelow
      ? target.y - selection.y - selection.h
      : selection.y - target.y - target.h;
    if (gap > MIN_GUIDE_GAP_MM) {
      const y1 = targetIsBelow ? selection.y + selection.h : target.y + target.h;
      const y2 = targetIsBelow ? target.y : selection.y;
      labels.push({
        id: 'hover-y',
        axis: 'y',
        x: centerX,
        y: (y1 + y2) / 2,
        valueMm: gap,
        x1: centerX,
        y1,
        x2: centerX,
        y2,
      });
    }
  } else {
    const topDelta = target.y - selection.y;
    if (Math.abs(topDelta) > MIN_GUIDE_GAP_MM) {
      const y1 = Math.min(selection.y, target.y);
      const y2 = Math.max(selection.y, target.y);
      labels.push({
        id: 'hover-y-top',
        axis: 'y',
        x: centerX,
        y: (y1 + y2) / 2,
        valueMm: Math.abs(topDelta),
        x1: centerX,
        y1,
        x2: centerX,
        y2,
      });
    }
    const bottomDelta = target.y + target.h - selection.y - selection.h;
    if (Math.abs(bottomDelta) > MIN_GUIDE_GAP_MM) {
      const y1 = Math.min(selection.y + selection.h, target.y + target.h);
      const y2 = Math.max(selection.y + selection.h, target.y + target.h);
      labels.push({
        id: 'hover-y-bottom',
        axis: 'y',
        x: centerX,
        y: (y1 + y2) / 2,
        valueMm: Math.abs(bottomDelta),
        x1: centerX,
        y1,
        x2: centerX,
        y2,
      });
    }
  }

  return labels;
}
