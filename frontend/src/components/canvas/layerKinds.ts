import type { CanvasLayerType } from './types';

const TEXTUAL_LAYER_TYPES = ['text', 'field'] as const satisfies readonly CanvasLayerType[];
const AUTO_LAYOUT_CONTAINER_TYPES = ['frame', 'group', 'component'] as const satisfies readonly CanvasLayerType[];
const NESTING_LAYER_TYPES = ['group', 'grid', 'frame', 'component'] as const satisfies readonly CanvasLayerType[];
const IMAGE_LAYER_TYPES = ['image', 'logo', 'imageSlot'] as const satisfies readonly CanvasLayerType[];
const VECTOR_SHAPE_LAYER_TYPES = [
  'rect',
  'ellipse',
  'arrow',
  'polygon',
  'star',
  'diamond',
  'hexagon',
  'pentagon',
] as const satisfies readonly CanvasLayerType[];

export type AutoLayoutContainerType = (typeof AUTO_LAYOUT_CONTAINER_TYPES)[number];

const TEXTUAL_SET: ReadonlySet<string> = new Set(TEXTUAL_LAYER_TYPES);
const AUTO_LAYOUT_SET: ReadonlySet<string> = new Set(AUTO_LAYOUT_CONTAINER_TYPES);
const NESTING_SET: ReadonlySet<string> = new Set(NESTING_LAYER_TYPES);
const IMAGE_SET: ReadonlySet<string> = new Set(IMAGE_LAYER_TYPES);
const VECTOR_SHAPE_SET: ReadonlySet<string> = new Set(VECTOR_SHAPE_LAYER_TYPES);

export function isTextualLayerType(type: CanvasLayerType): boolean {
  return TEXTUAL_SET.has(type);
}

export function isAutoLayoutContainerType(type: CanvasLayerType): boolean {
  return AUTO_LAYOUT_SET.has(type);
}

export function isNestingLayerType(type: CanvasLayerType): boolean {
  return NESTING_SET.has(type);
}

export function isImageLayerType(type: CanvasLayerType): boolean {
  return IMAGE_SET.has(type);
}

export function isVectorShapeLayerType(type: CanvasLayerType): boolean {
  return VECTOR_SHAPE_SET.has(type);
}
