
import type { AutoLayoutAlign, CanvasLayer, LayerAutoLayout } from '../types';
import { mm, parseMm } from '../types';

export type ChildBox = { x: number; y: number; w: number; h: number };

export const MIN_SIZE_MM = 1;

export interface ResolvedPadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export function resolvePadding(layout: LayerAutoLayout): ResolvedPadding {
  const fallback = Math.max(0, layout.padMm ?? 0);
  return {
    top: Math.max(0, layout.padTopMm ?? fallback),
    right: Math.max(0, layout.padRightMm ?? fallback),
    bottom: Math.max(0, layout.padBottomMm ?? fallback),
    left: Math.max(0, layout.padLeftMm ?? fallback),
  };
}

export function childBox(layer: CanvasLayer): ChildBox {
  return {
    x: parseMm(layer.cssVars['--translate-x']),
    y: parseMm(layer.cssVars['--translate-y']),
    w: Math.max(MIN_SIZE_MM, parseMm(layer.cssVars['--width'], 10)),
    h: Math.max(MIN_SIZE_MM, parseMm(layer.cssVars['--height'], 10)),
  };
}

function crossOffset(align: AutoLayoutAlign, free: number): number {
  if (align === 'center') return free / 2;
  if (align === 'end') return free;
  return 0;
}

interface LayoutItem {
  layer: CanvasLayer;
  box: ChildBox;
  isFillMain: boolean;
  isFillCross: boolean;
}

interface LayoutLine {
  items: LayoutItem[];
  lineCrossSize: number;
}

export function relayoutAutoFrame(
  frame: CanvasLayer,
  children: CanvasLayer[],
): { frame: CanvasLayer; children: CanvasLayer[] } {
  const layout = frame.meta?.autoLayout;
  if (!layout) return { frame, children };

  const visible = children.filter((c) => c.visible !== false);
  const fx = parseMm(frame.cssVars['--translate-x']);
  const fy = parseMm(frame.cssVars['--translate-y']);
  let fw = Math.max(MIN_SIZE_MM, parseMm(frame.cssVars['--width'], 10));
  let fh = Math.max(MIN_SIZE_MM, parseMm(frame.cssVars['--height'], 10));

  const pad = resolvePadding(layout);
  const gap = Math.max(0, layout.gapMm ?? 0);
  const crossGap = Math.max(0, layout.crossGapMm ?? gap);
  const isRow = layout.direction === 'row';
  const isWrap = Boolean(layout.wrap);

  const padMainStart = isRow ? pad.left : pad.top;
  const padMainTotal = isRow ? pad.left + pad.right : pad.top + pad.bottom;
  const padCrossStart = isRow ? pad.top : pad.left;
  const padCrossTotal = isRow ? pad.top + pad.bottom : pad.left + pad.right;

  const items: LayoutItem[] = visible.map((child) => {
    const box = childBox(child);
    const sizingMain = child.meta?.layoutSizingMain ?? 'fixed';
    const sizingCross = child.meta?.layoutSizingCross ?? 'fixed';
    return {
      layer: child,
      box,
      isFillMain: layout.sizing !== 'hug' && sizingMain === 'fill',
      isFillCross: sizingCross === 'fill' || layout.alignCross === 'stretch',
    };
  });

  const innerMain = Math.max(0, (isRow ? fw : fh) - padMainTotal);
  const lines: LayoutLine[] = [];
  let currentLine: LayoutItem[] = [];
  let currentMainUsed = 0;

  for (const item of items) {
    const itemMain = isRow ? item.box.w : item.box.h;
    const addedGap = currentLine.length > 0 ? gap : 0;

    if (isWrap && currentLine.length > 0 && currentMainUsed + addedGap + itemMain > innerMain) {
      const maxCross = currentLine.reduce(
        (m, it) => Math.max(m, isRow ? it.box.h : it.box.w),
        MIN_SIZE_MM,
      );
      lines.push({ items: currentLine, lineCrossSize: maxCross });
      currentLine = [item];
      currentMainUsed = itemMain;
    } else {
      currentLine.push(item);
      currentMainUsed += addedGap + itemMain;
    }
  }

  if (currentLine.length > 0 || items.length === 0) {
    const maxCross = currentLine.reduce(
      (m, it) => Math.max(m, isRow ? it.box.h : it.box.w),
      MIN_SIZE_MM,
    );
    lines.push({ items: currentLine, lineCrossSize: maxCross });
  }

  if (layout.sizing === 'hug') {
    if (isWrap) {
      const maxLineWidth = lines.reduce((max, line) => {
        const lineContent = line.items.reduce(
          (sum, it, idx) => sum + (isRow ? it.box.w : it.box.h) + (idx > 0 ? gap : 0),
          0,
        );
        return Math.max(max, lineContent);
      }, 0);

      const totalCrossHeight =
        lines.reduce((sum, line) => sum + line.lineCrossSize, 0) +
        Math.max(0, lines.length - 1) * crossGap;

      if (isRow) {
        fw = Math.max(MIN_SIZE_MM, maxLineWidth + padMainTotal);
        fh = Math.max(MIN_SIZE_MM, totalCrossHeight + padCrossTotal);
      } else {
        fh = Math.max(MIN_SIZE_MM, maxLineWidth + padMainTotal);
        fw = Math.max(MIN_SIZE_MM, totalCrossHeight + padCrossTotal);
      }
    } else {
      const allMainSizes = items.map((it) => (isRow ? it.box.w : it.box.h));
      const contentMain =
        allMainSizes.reduce((s, n) => s + n, 0) + gap * Math.max(0, items.length - 1);
      const maxCross = items.reduce(
        (m, it) => Math.max(m, isRow ? it.box.h : it.box.w),
        MIN_SIZE_MM,
      );

      if (isRow) {
        fw = Math.max(MIN_SIZE_MM, contentMain + padMainTotal);
        fh = Math.max(MIN_SIZE_MM, maxCross + padCrossTotal);
      } else {
        fh = Math.max(MIN_SIZE_MM, contentMain + padMainTotal);
        fw = Math.max(MIN_SIZE_MM, maxCross + padCrossTotal);
      }
    }
  }

  const finalInnerMain = Math.max(0, (isRow ? fw : fh) - padMainTotal);
  const finalInnerCross = Math.max(0, (isRow ? fh : fw) - padCrossTotal);

  const byId = new Map<string, CanvasLayer>();
  let crossCursor = padCrossStart;

  for (const line of lines) {
    const lineItems = line.items;
    const fillCount = lineItems.filter((it) => it.isFillMain).length;
    const fixedMainSum = lineItems
      .filter((it) => !it.isFillMain)
      .reduce((sum, it) => sum + (isRow ? it.box.w : it.box.h), 0);

    const lineGaps = gap * Math.max(0, lineItems.length - 1);
    const freeMain = Math.max(0, finalInnerMain - fixedMainSum - lineGaps);

    const fillItemMain =
      fillCount > 0 ? Math.max(MIN_SIZE_MM, freeMain / fillCount) : 0;

    let mainCursor = padMainStart;
    if (fillCount === 0 && layout.sizing === 'fixed') {
      const lineContentMain = fixedMainSum + lineGaps;
      const leftover = Math.max(0, finalInnerMain - lineContentMain);
      mainCursor += crossOffset(
        layout.alignMain === 'stretch' ? 'start' : layout.alignMain,
        leftover,
      );
    }

    const lineCrossExtent = isWrap ? line.lineCrossSize : finalInnerCross;

    for (const item of lineItems) {
      const mainSize = item.isFillMain
        ? fillItemMain
        : isRow
          ? item.box.w
          : item.box.h;

      let crossSize = isRow ? item.box.h : item.box.w;
      let crossPos = crossCursor;

      if (item.isFillCross) {
        crossSize = Math.max(MIN_SIZE_MM, lineCrossExtent);
      } else {
        const freeCross = Math.max(0, lineCrossExtent - crossSize);
        crossPos += crossOffset(layout.alignCross, freeCross);
      }

      const localX = isRow ? mainCursor : crossPos;
      const localY = isRow ? crossPos : mainCursor;
      const finalW = isRow ? mainSize : crossSize;
      const finalH = isRow ? crossSize : mainSize;

      byId.set(item.layer.id, {
        ...item.layer,
        cssVars: {
          ...item.layer.cssVars,
          '--translate-x': mm(fx + localX),
          '--translate-y': mm(fy + localY),
          '--width': mm(Math.max(MIN_SIZE_MM, finalW)),
          '--height': mm(Math.max(MIN_SIZE_MM, finalH)),
        },
      });

      mainCursor += mainSize + gap;
    }

    crossCursor += line.lineCrossSize + crossGap;
  }

  const nextChildren = children.map((c) => byId.get(c.id) ?? c);
  const nextFrame: CanvasLayer = {
    ...frame,
    cssVars: {
      ...frame.cssVars,
      '--width': mm(fw),
      '--height': mm(fh),
    },
  };
  return { frame: nextFrame, children: nextChildren };
}

export function defaultAutoLayout(): LayerAutoLayout {
  return {
    direction: 'row',
    gapMm: 4,
    padMm: 4,
    alignMain: 'start',
    alignCross: 'start',
    sizing: 'hug',
  };
}
