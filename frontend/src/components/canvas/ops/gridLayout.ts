import type { CanvasLayer, GridRule } from '../types';
import { mm, newId, parseMm } from '../types';

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

function createGridImageSlot(gridId: string, pageIndex: number, index: number): CanvasLayer {
  return {
    id: newId(),
    type: 'imageSlot',
    name: `Foto ${index + 1}`,
    value: '',
    pageIndex,
    parentId: gridId,
    cssVars: {
      '--width': mm(40),
      '--height': mm(40),
      '--translate-x': mm(0),
      '--translate-y': mm(0),
      '--background-color': '#f1f5f9',
      '--border-width': '1px',
      '--border-color': '#cbd5e1',
      '--object-fit': 'cover',
    },
    meta: { index },
  };
}

/**
 * Sync child image slots to cols×rows and relayout.
 * Used when the user edits Cols / Rows / Gap in the properties panel.
 */
export function rebuildGridSlots(layers: CanvasLayer[], gridLayerId: string): CanvasLayer[] {
  const grid = layers.find((l) => l.id === gridLayerId && l.type === 'grid');
  if (!grid) return layers;

  const cols = Math.max(1, Math.floor(grid.meta?.cols ?? 2));
  const rows = Math.max(1, Math.floor(grid.meta?.rows ?? 2));
  const target = cols * rows;
  const existing = gridChildSlots(layers, gridLayerId);
  const pageIndex = grid.pageIndex ?? 0;

  let next = layers;
  if (existing.length > target) {
    const removeIds = new Set(existing.slice(target).map((s) => s.id));
    next = next.filter((l) => !removeIds.has(l.id));
  } else if (existing.length < target) {
    const added: CanvasLayer[] = [];
    for (let i = existing.length; i < target; i += 1) {
      added.push(createGridImageSlot(gridLayerId, pageIndex, i));
    }
    next = [...next, ...added];
  }

  return applyGridToImageSlots(next, gridLayerId);
}

export function applyGridToImageSlots(
  layers: CanvasLayer[],
  gridLayerId: string,
  imageCount?: number,
): CanvasLayer[] {
  const grid = layers.find((l) => l.id === gridLayerId && l.type === 'grid');
  if (!grid) return layers;

  const slots = gridChildSlots(layers, gridLayerId);
  if (!slots.length && imageCount == null) return layers;

  const rules = grid.meta?.rules ?? DEFAULT_GRID_RULES;
  const fallback = {
    cols: Math.max(1, grid.meta?.cols ?? 2),
    rows: Math.max(1, grid.meta?.rows ?? 2),
  };
  // Adaptive rules only when generating/exporting with a known image count.
  // In the editor, respect the designed cols × rows from meta.
  const { cols, rows } =
    imageCount != null && imageCount > 0
      ? resolveGridLayout(imageCount, rules, fallback)
      : fallback;
  const gapMm = grid.meta?.gapMm ?? 2;

  const originX = parseMm(grid.cssVars['--translate-x']);
  const originY = parseMm(grid.cssVars['--translate-y']);
  const width = parseMm(grid.cssVars['--width'], 100);
  const height = parseMm(grid.cssVars['--height'], 100);
  const positions = layoutGridSlots(originX, originY, width, height, cols, rows, gapMm);

  const slotIds = new Set(slots.slice(0, positions.length).map((s) => s.id));

  const slotIndexById = new Map(slots.map((s, i) => [s.id, i]));

  return layers.map((layer) => {
    if (!slotIds.has(layer.id)) return layer;
    const index = slotIndexById.get(layer.id);
    if (index == null) return layer;
    const pos = positions[index];
    if (!pos) return layer;
    return {
      ...layer,
      name: `Foto ${index + 1}`,
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
