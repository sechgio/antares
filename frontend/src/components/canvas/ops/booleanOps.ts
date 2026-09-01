/**
 * Boolean layer ops — CSS composition (clip-path / blend / stack), NOT an exact
 * geometric boolean solver. Good enough for creative clip control in HTML/PDF export.
 */

import type { CanvasLayer, LayerCssVars } from '../types';
import { mm, parseMm } from '../types';
import { clipPathForOperandLayer } from './shapePaths';

export type BooleanOpKind = 'union' | 'subtract' | 'intersect' | 'exclude';

export type BooleanOperandRef = { op: BooleanOpKind; layerId: string };

export type BooleanRenderItem = {
  layerId: string;
  /** Source layer silhouette (CSS clip-path), when available. */
  clipPath?: string;
  /** Approximate CSS mix-blend-mode for subtract/intersect/exclude. */
  blendMode?: string;
  /**
   * When true, treat this operand as a subtract mask (inverted clip approximation).
   * Limitation: CSS cannot invert arbitrary polygon clip-paths exactly —
   * we approximate with mix-blend-mode / nested mask.
   */
  inverted?: boolean;
  /** Fill color taken from the operand (for stacked paint). */
  backgroundColor?: string;
  /** Position relative to the boolean layer origin (mm). */
  offsetXMm: number;
  offsetYMm: number;
  widthMm: number;
  heightMm: number;
};

export type BooleanRenderResult = {
  clipPath?: string;
  blendMode?: string;
  order: BooleanRenderItem[];
};

function layerBox(layer: CanvasLayer): { x: number; y: number; w: number; h: number } {
  return {
    x: parseMm(layer.cssVars['--translate-x']),
    y: parseMm(layer.cssVars['--translate-y']),
    w: Math.max(0.01, parseMm(layer.cssVars['--width'], 40)),
    h: Math.max(0.01, parseMm(layer.cssVars['--height'], 40)),
  };
}

function unifyBBox(layers: CanvasLayer[]): Pick<LayerCssVars, '--width' | '--height' | '--translate-x' | '--translate-y'> {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const layer of layers) {
    const b = layerBox(layer);
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  }
  if (!Number.isFinite(minX)) {
    return {
      '--width': mm(40),
      '--height': mm(40),
      '--translate-x': mm(0),
      '--translate-y': mm(0),
    };
  }
  return {
    '--translate-x': mm(minX),
    '--translate-y': mm(minY),
    '--width': mm(Math.max(0.01, maxX - minX)),
    '--height': mm(Math.max(0.01, maxY - minY)),
  };
}

function normalizeBooleanOperands(
  operands: Array<CanvasLayer | { layer: CanvasLayer; op?: BooleanOpKind }>,
): Array<{ layer: CanvasLayer; op: BooleanOpKind }> {
  return operands.map((entry) =>
    typeof entry === 'object' && entry !== null && 'layer' in entry && (entry as { layer: CanvasLayer }).layer
      ? {
          layer: (entry as { layer: CanvasLayer; op?: BooleanOpKind }).layer,
          op: (entry as { layer: CanvasLayer; op?: BooleanOpKind }).op ?? ('union' as BooleanOpKind),
        }
      : { layer: entry as CanvasLayer, op: 'union' as BooleanOpKind },
  );
}

/**
 * Build a type:'boolean' layer from a base + operands.
 * Empty operands → return base unchanged (legacy-safe).
 * Default operand op is `union` when not specified on the operand entry.
 *
 * Note: converts `base` in place (same id). Operand layers stay in the document
 * and are referenced by meta.ops; callers should hide them (see
 * {@link applyBooleanCompose}) so they are not painted twice.
 */
export function composeBoolean(
  base: CanvasLayer,
  operands: Array<CanvasLayer | { layer: CanvasLayer; op?: BooleanOpKind }>,
): CanvasLayer {
  if (!operands.length) return base;

  const normalized = normalizeBooleanOperands(operands);
  const bbox = unifyBBox([base, ...normalized.map((n) => n.layer)]);
  const ops: BooleanOperandRef[] = normalized.map((n) => ({
    op: n.op,
    layerId: n.layer.id,
  }));

  return {
    ...base,
    type: 'boolean',
    name: base.name || 'Booleana',
    cssVars: {
      ...base.cssVars,
      ...bbox,
    },
    meta: {
      ...base.meta,
      ops,
    },
  };
}

/**
 * Compose a boolean layer and hide operand layers so Artboard does not paint
 * them both standalone and inside the boolean stack.
 */
export function applyBooleanCompose(
  layers: CanvasLayer[],
  base: CanvasLayer,
  operands: Array<CanvasLayer | { layer: CanvasLayer; op?: BooleanOpKind }>,
): CanvasLayer[] {
  if (!operands.length) return layers;
  const normalized = normalizeBooleanOperands(operands);
  const composed = composeBoolean(base, normalized);
  const hideIds = new Set(normalized.map((n) => n.layer.id));
  return layers.map((layer) => {
    if (layer.id === composed.id) return composed;
    if (hideIds.has(layer.id)) return { ...layer, visible: false };
    return layer;
  });
}

const compositionHiddenCache = new WeakMap<CanvasLayer[], Set<string>>();

/** Layer ids that must not paint as standalone nodes (boolean operands / masks). */
export function compositionHiddenLayerIds(layers: CanvasLayer[]): Set<string> {
  const cached = compositionHiddenCache.get(layers);
  if (cached) return cached;
  const hide = new Set<string>();
  for (const layer of layers) {
    for (const op of layer.meta?.ops ?? []) {
      if (op.layerId) hide.add(op.layerId);
    }
    if (layer.meta?.maskLayerId) hide.add(layer.meta.maskLayerId);
  }
  compositionHiddenCache.set(layers, hide);
  return hide;
}

function blendForOp(op: BooleanOpKind): string | undefined {
  switch (op) {
    case 'subtract':
      // Approximate hole-punch; not geometrically exact.
      return 'difference';
    case 'intersect':
      return 'darken';
    case 'exclude':
      return 'exclusion';
    default:
      return undefined;
  }
}

/**
 * Resolve CSS composition data for painting a boolean layer.
 * Does NOT solve exact geometry — returns clip/blend hints for LayerNode.
 *
 * Order starts with the boolean layer's own fill (base plate over the unified
 * bbox), then each operand from meta.ops.
 */
export function resolveBooleanRender(
  booleanLayer: CanvasLayer,
  allLayers: CanvasLayer[],
): BooleanRenderResult {
  const ops = booleanLayer.meta?.ops;
  if (!ops?.length) {
    return { order: [] };
  }

  const byId = new Map(allLayers.map((l) => [l.id, l]));
  const origin = layerBox(booleanLayer);
  const order: BooleanRenderItem[] = [
    {
      layerId: booleanLayer.id,
      clipPath: undefined,
      backgroundColor: booleanLayer.cssVars['--background-color'],
      offsetXMm: 0,
      offsetYMm: 0,
      widthMm: origin.w,
      heightMm: origin.h,
    },
  ];

  for (const entry of ops) {
    const src = byId.get(entry.layerId);
    if (!src || src.id === booleanLayer.id) continue;
    const box = layerBox(src);
    const clipPath = clipPathForOperandLayer(src);
    const inverted = entry.op === 'subtract';
    order.push({
      layerId: src.id,
      clipPath,
      blendMode: blendForOp(entry.op),
      inverted,
      backgroundColor: src.cssVars['--background-color'] || booleanLayer.cssVars['--background-color'],
      offsetXMm: box.x - origin.x,
      offsetYMm: box.y - origin.y,
      widthMm: box.w,
      heightMm: box.h,
    });
  }

  // Outline approximation: first operand clip (skip base plate).
  const outline = order.slice(1).find((item) => !item.inverted && item.clipPath)?.clipPath
    ?? order.slice(1).find((item) => item.clipPath)?.clipPath;

  return {
    clipPath: outline,
    blendMode: undefined,
    order,
  };
}
