
import type { CanvasLayer } from '../types';
import { parseMm } from '../types';

export const SHAPE_CLIP_PATHS = {
  polygon: 'polygon(50% 0%, 0% 100%, 100% 100%)',
  star: 'polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)',
  arrow: 'polygon(0% 35%, 65% 35%, 65% 10%, 100% 50%, 65% 90%, 65% 65%, 0% 65%)',
  diamond: 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)',
  hexagon: 'polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)',
  pentagon: 'polygon(50% 0%, 100% 38%, 82% 100%, 18% 100%, 0% 38%)',
} as const;

export type ClippedShapeType = keyof typeof SHAPE_CLIP_PATHS;

export function clipPathForLayerType(type: string): string | undefined {
  if (type in SHAPE_CLIP_PATHS) {
    return SHAPE_CLIP_PATHS[type as ClippedShapeType];
  }
  return undefined;
}

export function clipPathFromMetaPath(layer: CanvasLayer): string | undefined {
  const points = layer.meta?.path?.points;
  if (!points?.length) return undefined;
  const w = Math.max(0.01, parseMm(layer.cssVars['--width'], 40));
  const h = Math.max(0.01, parseMm(layer.cssVars['--height'], 40));

  if (points.length === 1) {
    return 'circle(50% at 50% 50%)';
  }
  if (points.length === 2 && Math.abs(w - h) < 0.01) {
    return 'circle(50% at 50% 50%)';
  }

  const parts = points.map((pt) => {
    const px = Math.round((pt.x / w) * 10000) / 100;
    const py = Math.round((pt.y / h) * 10000) / 100;
    return `${px}% ${py}%`;
  });
  return `polygon(${parts.join(', ')})`;
}

export function clipPathForOperandLayer(layer: CanvasLayer): string | undefined {
  const byType = clipPathForLayerType(layer.type);
  if (byType) return byType;
  if (layer.type === 'ellipse') return 'ellipse(50% 50% at 50% 50%)';
  const fromPath = clipPathFromMetaPath(layer);
  if (fromPath) return fromPath;
  return undefined;
}

function clipPathForBooleanLayer(
  layer: CanvasLayer,
  allLayers: CanvasLayer[],
): string | undefined {
  const ops = layer.meta?.ops;
  if (!ops?.length) return undefined;
  const byId = new Map(allLayers.map((l) => [l.id, l]));
  let fallback: string | undefined;
  for (const entry of ops) {
    const src = byId.get(entry.layerId);
    if (!src) continue;
    const clip = clipPathForOperandLayer(src);
    if (!clip) continue;
    if (entry.op !== 'subtract') return clip;
    fallback ??= clip;
  }
  return fallback;
}

export function clipPathForLayer(
  layer: CanvasLayer,
  allLayers?: CanvasLayer[],
): string | undefined {
  if (layer.type === 'boolean') {
    if (!allLayers?.length) return undefined;
    return clipPathForBooleanLayer(layer, allLayers);
  }
  return clipPathForOperandLayer(layer);
}

export const SHAPE_TOOLS = new Set([
  'rect',
  'ellipse',
  'line',
  'arrow',
  'polygon',
  'star',
  'diamond',
  'hexagon',
  'pentagon',
]);

export type ShapeTool =
  | 'rect'
  | 'ellipse'
  | 'line'
  | 'arrow'
  | 'polygon'
  | 'star'
  | 'diamond'
  | 'hexagon'
  | 'pentagon';

export function isShapeTool(tool: string): tool is ShapeTool {
  return SHAPE_TOOLS.has(tool);
}

const SQUARE_CONSTRAIN_TOOLS = new Set([
  'rect',
  'ellipse',
  'polygon',
  'star',
  'diamond',
  'hexagon',
  'pentagon',
]);

export function isSquareConstrainTool(tool: string): boolean {
  return SQUARE_CONSTRAIN_TOOLS.has(tool);
}
