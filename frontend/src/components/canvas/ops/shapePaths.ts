/** CSS clip-path values for vector-like shape layers. */

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

/** Tools whose draw gesture constrains to a square while Shift is held. */
export function isSquareConstrainTool(tool: string): boolean {
  return SQUARE_CONSTRAIN_TOOLS.has(tool);
}

