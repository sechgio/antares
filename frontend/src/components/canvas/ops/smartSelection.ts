import type { CanvasLayer } from '../types';
import { layerBounds } from './layerBounds';
import { distributeLayers, nudgeLayers } from './layerOps';
import type { RectMm } from './selectionTransform';

export type SmartBounds = ReturnType<typeof layerBounds>;

export interface SmartSequence {
  axis: 'x' | 'y';
  ids: string[];
  bounds: SmartBounds[];
  gaps: number[];
  uniform: boolean;
}

const UNIFORM_TOL_MM = 0.05;
const CROSS_OVERLAP_MIN_MM = 0.5;

export function detectSmartSequence(
  layers: CanvasLayer[],
  ids: readonly string[],
): SmartSequence | null {
  const byId = new Map(layers.map((l) => [l.id, l]));
  const boxes: Array<{ id: string; b: SmartBounds }> = [];
  for (const id of ids) {
    const layer = byId.get(id);
    if (!layer || layer.locked || layer.type === 'frame' || layer.visible === false) continue;
    boxes.push({ id, b: layerBounds(layer) });
  }
  if (boxes.length < 2) return null;
  return buildSequence(boxes, 'x') ?? buildSequence(boxes, 'y');
}

function buildSequence(
  boxes: Array<{ id: string; b: SmartBounds }>,
  axis: 'x' | 'y',
): SmartSequence | null {
  const sorted = [...boxes].sort((a, b) => (axis === 'x' ? a.b.x - b.b.x : a.b.y - b.b.y));
  const gaps: number[] = [];
  for (let i = 0; i < sorted.length - 1; i += 1) {
    const a = sorted[i]!.b;
    const n = sorted[i + 1]!.b;
    const overlap =
      axis === 'x'
        ? Math.min(a.bottom, n.bottom) - Math.max(a.y, n.y)
        : Math.min(a.right, n.right) - Math.max(a.x, n.x);
    if (overlap < CROSS_OVERLAP_MIN_MM) return null;
    gaps.push(axis === 'x' ? n.x - a.right : n.y - a.bottom);
  }
  const uniform = gaps.every((g) => Math.abs(g - gaps[0]!) <= UNIFORM_TOL_MM);
  return {
    axis,
    ids: sorted.map((b) => b.id),
    bounds: sorted.map((b) => b.b),
    gaps,
    uniform,
  };
}

export function smartGapRect(seq: SmartSequence, index: number): RectMm {
  const a = seq.bounds[index]!;
  const n = seq.bounds[index + 1]!;
  if (seq.axis === 'x') {
    const top = Math.max(a.y, n.y);
    const bottom = Math.min(a.bottom, n.bottom);
    return { x: a.right, y: top, w: n.x - a.right, h: Math.max(0, bottom - top) };
  }
  const left = Math.max(a.x, n.x);
  const right = Math.min(a.right, n.right);
  return { x: left, y: a.bottom, w: Math.max(0, right - left), h: n.y - a.bottom };
}

export function resizeSmartGap(
  layers: CanvasLayer[],
  seq: Pick<SmartSequence, 'axis' | 'ids' | 'gaps'>,
  index: number,
  newGapMm: number,
): CanvasLayer[] {
  const delta = newGapMm - (seq.gaps[index] ?? 0);
  if (Math.abs(delta) < 0.001) return layers;
  const followers = seq.ids.slice(index + 1);
  if (!followers.length) return layers;
  return nudgeLayers(layers, followers, seq.axis === 'x' ? delta : 0, seq.axis === 'y' ? delta : 0);
}

export function tidySmartSequence(layers: CanvasLayer[], seq: SmartSequence): CanvasLayer[] {
  if (seq.ids.length < 3) return layers;
  return distributeLayers(layers, seq.ids, seq.axis === 'x' ? 'horizontal' : 'vertical', {
    mode: 'gaps',
    sortBy: 'edge',
  });
}
