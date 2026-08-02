/**
 * Pure auto-layout for frame/group containers.
 * Positions children via existing --translate-x/y / --width/--height cssVars.
 * Absent meta.autoLayout → no-op (legacy safe).
 */

import type { AutoLayoutAlign, CanvasLayer, LayerAutoLayout } from '../types';
import { mm, parseMm } from '../types';

export type ChildBox = { x: number; y: number; w: number; h: number };

const MIN_SIZE_MM = 1;

/** Read geometry box from layer cssVars (mm). */
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

function applyCross(
  align: AutoLayoutAlign,
  pad: number,
  frameCross: number,
  childCross: number,
): { origin: number; size: number } {
  const inner = Math.max(MIN_SIZE_MM, frameCross - 2 * pad);
  if (align === 'stretch') {
    return { origin: pad, size: inner };
  }
  const free = inner - childCross;
  return { origin: pad + crossOffset(align, free), size: childCross };
}

/**
 * Relayout direct children of a frame/group that has meta.autoLayout.
 * Child --translate-x/y are written in page space (frame origin + local offset).
 */
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

  const pad = Math.max(0, layout.padMm);
  const gap = Math.max(0, layout.gapMm);
  const isRow = layout.direction === 'row';

  const boxes = visible.map(childBox);
  const mainSizes = boxes.map((b) => (isRow ? b.w : b.h));
  const contentMain =
    mainSizes.reduce((s, n) => s + n, 0) + gap * Math.max(0, visible.length - 1);

  if (layout.sizing === 'hug') {
    const maxCross = boxes.reduce((m, b) => Math.max(m, isRow ? b.h : b.w), MIN_SIZE_MM);
    if (isRow) {
      fw = Math.max(MIN_SIZE_MM, contentMain + 2 * pad);
      fh = Math.max(MIN_SIZE_MM, maxCross + 2 * pad);
    } else {
      fh = Math.max(MIN_SIZE_MM, contentMain + 2 * pad);
      fw = Math.max(MIN_SIZE_MM, maxCross + 2 * pad);
    }
  }

  const innerMain = Math.max(0, (isRow ? fw : fh) - 2 * pad);
  let mainCursor = pad;
  if (layout.sizing === 'fixed') {
    const free = innerMain - contentMain;
    mainCursor = pad + crossOffset(layout.alignMain === 'stretch' ? 'start' : layout.alignMain, free);
  }

  const byId = new Map<string, CanvasLayer>();
  let cursor = mainCursor;
  visible.forEach((child, i) => {
    const box = boxes[i]!;
    const mainSize = isRow ? box.w : box.h;
    const cross = applyCross(layout.alignCross, pad, isRow ? fh : fw, isRow ? box.h : box.w);
    const localX = isRow ? cursor : cross.origin;
    const localY = isRow ? cross.origin : cursor;
    const nextW = isRow ? box.w : cross.size;
    const nextH = isRow ? cross.size : box.h;
    byId.set(child.id, {
      ...child,
      cssVars: {
        ...child.cssVars,
        '--translate-x': mm(fx + localX),
        '--translate-y': mm(fy + localY),
        '--width': mm(Math.max(MIN_SIZE_MM, nextW)),
        '--height': mm(Math.max(MIN_SIZE_MM, nextH)),
      },
    });
    cursor += mainSize + gap;
  });

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
