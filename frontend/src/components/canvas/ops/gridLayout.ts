import type { CanvasLayer, GridRule } from '../types';
import { mm, parseMm } from '../types';

export type { GridRule };

export const DEFAULT_GRID_RULES: GridRule[] = [
  { whenImages: 4, cols: 2, rows: 2 },
  { whenImages: 6, cols: 3, rows: 2 },
  { whenImages: 9, cols: 3, rows: 3 },
];

export function resolveGridLayout(
  imageCount: number,
  rules: GridRule[],
  fallback: { cols: number; rows: number },
): { cols: number; rows: number } {
  const match = rules.find((rule) => rule.whenImages === imageCount);
  if (match) return { cols: match.cols, rows: match.rows };
  return fallback;
}

export function layoutGridSlots(
  originX: number,
  originY: number,
  width: number,
  height: number,
  cols: number,
  rows: number,
  gapMm: number,
): Array<{ x: number; y: number; w: number; h: number }> {
  const totalGapX = gapMm * Math.max(cols - 1, 0);
  const totalGapY = gapMm * Math.max(rows - 1, 0);
  const cellW = cols > 0 ? (width - totalGapX) / cols : width;
  const cellH = rows > 0 ? (height - totalGapY) / rows : height;
  const slots: Array<{ x: number; y: number; w: number; h: number }> = [];

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      slots.push({
        x: originX + col * (cellW + gapMm),
        y: originY + row * (cellH + gapMm),
        w: cellW,
        h: cellH,
      });
    }
  }

  return slots;
}

function gridChildSlots(layers: CanvasLayer[], gridLayerId: string): CanvasLayer[] {
  const byParent = layers.filter((l) => l.parentId === gridLayerId && l.type === 'imageSlot');
  if (byParent.length) {
    return [...byParent].sort((a, b) => (a.meta?.index ?? 0) - (b.meta?.index ?? 0));
  }
  return layers
    .filter((l) => l.type === 'imageSlot' && l.meta?.index != null)
    .sort((a, b) => (a.meta?.index ?? 0) - (b.meta?.index ?? 0));
}

export function applyGridToImageSlots(
  layers: CanvasLayer[],
  gridLayerId: string,
  imageCount?: number,
): CanvasLayer[] {
  const grid = layers.find((l) => l.id === gridLayerId && l.type === 'grid');
  if (!grid) return layers;

  const slots = gridChildSlots(layers, gridLayerId);
  const count = imageCount ?? slots.length;
  if (!count) return layers;

  const rules = grid.meta?.rules ?? DEFAULT_GRID_RULES;
  const fallback = {
    cols: grid.meta?.cols ?? 2,
    rows: grid.meta?.rows ?? 2,
  };
  const { cols, rows } = resolveGridLayout(count, rules, fallback);
  const gapMm = grid.meta?.gapMm ?? 2;

  const originX = parseMm(grid.cssVars['--translate-x']);
  const originY = parseMm(grid.cssVars['--translate-y']);
  const width = parseMm(grid.cssVars['--width'], 100);
  const height = parseMm(grid.cssVars['--height'], 100);
  const positions = layoutGridSlots(originX, originY, width, height, cols, rows, gapMm);

  const slotIds = new Set(slots.slice(0, positions.length).map((s) => s.id));

  return layers.map((layer) => {
    if (!slotIds.has(layer.id)) return layer;
    const index = slots.findIndex((s) => s.id === layer.id);
    const pos = positions[index];
    if (!pos) return layer;
    return {
      ...layer,
      parentId: gridLayerId,
      cssVars: {
        ...layer.cssVars,
        '--translate-x': mm(pos.x),
        '--translate-y': mm(pos.y),
        '--width': mm(pos.w),
        '--height': mm(pos.h),
      },
      meta: { ...layer.meta, index },
    };
  });
}
