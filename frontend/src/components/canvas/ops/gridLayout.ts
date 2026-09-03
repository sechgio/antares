import type { CanvasLayer, GridRule } from '../types';
import { mm, newId, parseMm } from '../types';

export type { GridRule };

export const DEFAULT_GRID_RULES: GridRule[] = [
  { whenImages: 4, cols: 2, rows: 2 },
  { whenImages: 6, cols: 3, rows: 2 },
  { whenImages: 9, cols: 3, rows: 3 },
];

export const MAX_GRID_DIM = 12;
export const MIN_GRID_CELL_MM = 2;

export function clampGridDim(n: number): number {
  return Math.min(MAX_GRID_DIM, Math.max(1, Math.floor(n)));
}

export function resolveGridLayout(
  imageCount: number,
  rules: GridRule[],
  fallback: { cols: number; rows: number },
): { cols: number; rows: number } {
  const match = rules.find((rule) => rule.whenImages === imageCount);
  if (match) return { cols: match.cols, rows: match.rows };
  return fallback;
}

export function normalizeTracks(tracks: number[] | undefined, count: number): number[] {
  const n = Math.max(0, count);
  if (n === 0) return [];
  if (tracks && tracks.length === n && tracks.every((t) => Number.isFinite(t) && t > 0)) {
    return tracks.map((t) => t);
  }
  if (tracks && tracks.length > 0) {
    const next = tracks.slice(0, n).map((t) => (Number.isFinite(t) && t > 0 ? t : 1));
    while (next.length < n) next.push(1);
    return next;
  }
  return Array.from({ length: n }, () => 1);
}

function sizesFromTracks(tracks: number[], available: number, minMm: number): number[] {
  if (tracks.length === 0) return [];
  const minTotal = minMm * tracks.length;
  const usable = Math.max(minTotal, available);
  const sum = tracks.reduce((a, b) => a + b, 0) || tracks.length;
  const raw = tracks.map((t) => (t / sum) * usable);
  const sizes = raw.map((s) => Math.max(minMm, s));
  let overflow = sizes.reduce((a, b) => a + b, 0) - usable;
  if (overflow <= 1e-9) return sizes;
  for (let pass = 0; pass < 8 && overflow > 1e-9; pass += 1) {
    const flexible = sizes
      .map((s, i) => (s > minMm + 1e-9 ? i : -1))
      .filter((i) => i >= 0);
    if (!flexible.length) break;
    const share = overflow / flexible.length;
    for (const i of flexible) {
      const reducible = sizes[i]! - minMm;
      const take = Math.min(reducible, share);
      sizes[i]! -= take;
      overflow -= take;
    }
  }
  return sizes;
}

export function layoutGridSlots(
  originX: number,
  originY: number,
  width: number,
  height: number,
  cols: number,
  rows: number,
  gapMm: number,
  tracks?: { cols?: number[]; rows?: number[] },
): Array<{ x: number; y: number; w: number; h: number }> {
  const safeCols = Math.max(0, cols);
  const safeRows = Math.max(0, rows);
  const gap = Math.max(0, gapMm);
  const totalGapX = gap * Math.max(safeCols - 1, 0);
  const totalGapY = gap * Math.max(safeRows - 1, 0);
  const availableW = width - totalGapX;
  const availableH = height - totalGapY;
  const colTracks = normalizeTracks(tracks?.cols, safeCols);
  const rowTracks = normalizeTracks(tracks?.rows, safeRows);
  const colSizes = sizesFromTracks(colTracks, availableW, MIN_GRID_CELL_MM);
  const rowSizes = sizesFromTracks(rowTracks, availableH, MIN_GRID_CELL_MM);
  const slots: Array<{ x: number; y: number; w: number; h: number }> = [];

  let y = originY;
  for (let row = 0; row < safeRows; row += 1) {
    const h = rowSizes[row] ?? MIN_GRID_CELL_MM;
    let x = originX;
    for (let col = 0; col < safeCols; col += 1) {
      const w = colSizes[col] ?? MIN_GRID_CELL_MM;
      slots.push({ x, y, w, h });
      x += w + (col < safeCols - 1 ? gap : 0);
    }
    y += h + (row < safeRows - 1 ? gap : 0);
  }

  return slots;
}

function gridChildSlots(layers: CanvasLayer[], gridLayerId: string): CanvasLayer[] {
  return layers
    .filter((l) => l.parentId === gridLayerId && l.type === 'imageSlot')
    .sort((a, b) => (a.meta?.index ?? 0) - (b.meta?.index ?? 0));
}

export function gridSlotLayoutMetaChanged(
  prev: CanvasLayer['meta'] | undefined,
  next: CanvasLayer['meta'] | undefined,
): boolean {
  return (
    (prev?.cols ?? 2) !== (next?.cols ?? 2) ||
    (prev?.rows ?? 2) !== (next?.rows ?? 2) ||
    (prev?.gapMm ?? 2) !== (next?.gapMm ?? 2)
  );
}

export function applyLivePanelLayerChange(
  layers: CanvasLayer[],
  prev: CanvasLayer | undefined,
  layer: CanvasLayer,
): CanvasLayer[] {
  let next = layers.map((l) => (l.id === layer.id ? layer : l));
  if (layer.type === 'grid' && gridSlotLayoutMetaChanged(prev?.meta, layer.meta)) {
    next = rebuildGridSlots(next, layer.id);
  }
  return next;
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

export function rebuildGridSlots(layers: CanvasLayer[], gridLayerId: string): CanvasLayer[] {
  const grid = layers.find((l) => l.id === gridLayerId && l.type === 'grid');
  if (!grid) return layers;

  const cols = clampGridDim(grid.meta?.cols ?? 2);
  const rows = clampGridDim(grid.meta?.rows ?? 2);
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

  const colTracks = normalizeTracks(grid.meta?.colTracks, cols);
  const rowTracks = normalizeTracks(grid.meta?.rowTracks, rows);
  next = next.map((l) =>
    l.id === gridLayerId
      ? {
          ...l,
          meta: {
            ...l.meta,
            cols,
            rows,
            colTracks,
            rowTracks,
          },
        }
      : l,
  );

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
    cols: clampGridDim(grid.meta?.cols ?? 2),
    rows: clampGridDim(grid.meta?.rows ?? 2),
  };
  const { cols, rows } =
    imageCount != null && imageCount > 0
      ? resolveGridLayout(imageCount, rules, fallback)
      : fallback;
  const gapMm = Math.max(0, grid.meta?.gapMm ?? 2);
  const colTracks = normalizeTracks(grid.meta?.colTracks, cols);
  const rowTracks = normalizeTracks(grid.meta?.rowTracks, rows);

  const originX = parseMm(grid.cssVars['--translate-x']);
  const originY = parseMm(grid.cssVars['--translate-y']);
  const width = parseMm(grid.cssVars['--width'], 100);
  const height = parseMm(grid.cssVars['--height'], 100);
  const positions = layoutGridSlots(originX, originY, width, height, cols, rows, gapMm, {
    cols: colTracks,
    rows: rowTracks,
  });

  const slotIds = new Set(slots.slice(0, positions.length).map((s) => s.id));

  const slotIndexById = new Map(slots.map((s, i) => [s.id, i]));

  return layers.map((layer) => {
    if (layer.id === gridLayerId) {
      return {
        ...layer,
        meta: {
          ...layer.meta,
          cols,
          rows,
          colTracks,
          rowTracks,
        },
      };
    }
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

export function matchGridSlotsToSourceSize(
  layers: CanvasLayer[],
  sourceSlotId: string,
): CanvasLayer[] {
  const slot = layers.find((l) => l.id === sourceSlotId && l.type === 'imageSlot');
  if (!slot?.parentId) return layers;
  const grid = layers.find((l) => l.id === slot.parentId && l.type === 'grid');
  if (!grid) return layers;

  const cols = clampGridDim(grid.meta?.cols ?? 2);
  const rows = clampGridDim(grid.meta?.rows ?? 2);
  const gapMm = Math.max(0, grid.meta?.gapMm ?? 2);
  const cellW = Math.max(MIN_GRID_CELL_MM, parseMm(slot.cssVars['--width'], MIN_GRID_CELL_MM));
  const cellH = Math.max(MIN_GRID_CELL_MM, parseMm(slot.cssVars['--height'], MIN_GRID_CELL_MM));

  const originX = parseMm(grid.cssVars['--translate-x']);
  const originY = parseMm(grid.cssVars['--translate-y']);
  const currentW = parseMm(grid.cssVars['--width'], 100);
  const currentH = parseMm(grid.cssVars['--height'], 100);

  const contentW = cellW * cols + gapMm * Math.max(cols - 1, 0);
  const contentH = cellH * rows + gapMm * Math.max(rows - 1, 0);
  const gridW = Math.max(currentW, contentW);
  const gridH = Math.max(currentH, contentH);
  const padX = (gridW - contentW) / 2;
  const padY = (gridH - contentH) / 2;

  const colTracks = Array.from({ length: cols }, () => 1);
  const rowTracks = Array.from({ length: rows }, () => 1);
  const positions = layoutGridSlots(
    originX + padX,
    originY + padY,
    contentW,
    contentH,
    cols,
    rows,
    gapMm,
    { cols: colTracks, rows: rowTracks },
  );

  const slots = gridChildSlots(layers, grid.id);
  const slotIds = new Set(slots.slice(0, positions.length).map((s) => s.id));
  const slotIndexById = new Map(slots.map((s, i) => [s.id, i]));

  return layers.map((layer) => {
    if (layer.id === grid.id) {
      return {
        ...layer,
        cssVars: {
          ...layer.cssVars,
          '--width': mm(gridW),
          '--height': mm(gridH),
        },
        meta: {
          ...layer.meta,
          cols,
          rows,
          gapMm,
          colTracks,
          rowTracks,
        },
      };
    }
    if (!slotIds.has(layer.id)) return layer;
    const index = slotIndexById.get(layer.id);
    if (index == null) return layer;
    const pos = positions[index];
    if (!pos) return layer;
    return {
      ...layer,
      name: `Foto ${index + 1}`,
      parentId: grid.id,
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
