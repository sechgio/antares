import type { CanvasLayer } from '../types';
import { mm, newId, parseMm } from '../types';
import { expandWithDescendants } from './layerTree';

const NUDGE_OFFSET_MM = 5;

function layerBounds(layer: CanvasLayer) {
  const x = parseMm(layer.cssVars['--translate-x']);
  const y = parseMm(layer.cssVars['--translate-y']);
  const w = parseMm(layer.cssVars['--width'], 10);
  const h = parseMm(layer.cssVars['--height'], 10);
  const rotate = parseFloat(layer.cssVars['--rotate'] || '0') || 0;
  if (!rotate) {
    return { x, y, w, h, right: x + w, bottom: y + h, cx: x + w / 2, cy: y + h / 2 };
  }
  // Visual AABB of rotated box (transform-origin center).
  const cx = x + w / 2;
  const cy = y + h / 2;
  const rad = (rotate * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const corners = [
    { dx: -w / 2, dy: -h / 2 },
    { dx: w / 2, dy: -h / 2 },
    { dx: w / 2, dy: h / 2 },
    { dx: -w / 2, dy: h / 2 },
  ].map(({ dx, dy }) => ({ x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos }));
  const minX = Math.min(...corners.map((c) => c.x));
  const maxX = Math.max(...corners.map((c) => c.x));
  const minY = Math.min(...corners.map((c) => c.y));
  const maxY = Math.max(...corners.map((c) => c.y));
  return {
    x: minX,
    y: minY,
    w: maxX - minX,
    h: maxY - minY,
    right: maxX,
    bottom: maxY,
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
  };
}

function isLocked(layer: CanvasLayer): boolean {
  return Boolean(layer.locked);
}

function resolvedParentId(layers: CanvasLayer[], layer: CanvasLayer): string | undefined {
  return layer.parentId && layers.some((l) => l.id === layer.parentId) ? layer.parentId : undefined;
}

/** Move root ids by delta, expanding descendants (like nudge/move). */
function translateRoots(
  layers: CanvasLayer[],
  rootIds: string[],
  dx: number,
  dy: number,
): CanvasLayer[] {
  if (dx === 0 && dy === 0) return layers;
  const roots = new Set(rootIds);
  const idSet = new Set(expandWithDescendants(layers, rootIds));
  return layers.map((layer) => {
    if (!idSet.has(layer.id) || layer.type === 'frame') return layer;
    if (roots.has(layer.id) && isLocked(layer)) return layer;
    return {
      ...layer,
      cssVars: {
        ...layer.cssVars,
        '--translate-x': mm(parseMm(layer.cssVars['--translate-x']) + dx),
        '--translate-y': mm(parseMm(layer.cssVars['--translate-y']) + dy),
      },
    };
  });
}

/**
 * Reorder siblings so `siblingIds` sit at the front (or back) of their parent group,
 * preserving relative order of movers and of non-movers.
 */
function reorderSiblingsExtreme(
  layers: CanvasLayer[],
  siblingIds: string[],
  place: 'front' | 'back',
): CanvasLayer[] {
  if (!siblingIds.length) return layers;
  const sample = layers.find((l) => l.id === siblingIds[0]);
  if (!sample) return layers;
  const parent = resolvedParentId(layers, sample);
  const order = layers.filter((l) => l.type !== 'frame' && resolvedParentId(layers, l) === parent);
  const moving = order.filter((l) => siblingIds.includes(l.id));
  const staying = order.filter((l) => !siblingIds.includes(l.id));
  const reordered = place === 'front' ? [...staying, ...moving] : [...moving, ...staying];
  const siblingSet = new Set(order.map((l) => l.id));
  const result: CanvasLayer[] = [];
  let inserted = false;
  for (const layer of layers) {
    if (!siblingSet.has(layer.id)) {
      result.push(layer);
      continue;
    }
    if (!inserted) {
      result.push(...reordered);
      inserted = true;
    }
  }
  return result;
}

/** Bring selected layers to the front among their siblings (parent-scoped). */
export function bringToFront(layers: CanvasLayer[], ids: string[]): CanvasLayer[] {
  const idSet = new Set(ids);
  const selected = layers.filter((l) => idSet.has(l.id) && !isLocked(l) && l.type !== 'frame');
  if (!selected.length) return layers;

  const byParent = new Map<string | undefined, string[]>();
  for (const layer of selected) {
    const parent = resolvedParentId(layers, layer);
    const list = byParent.get(parent) ?? [];
    list.push(layer.id);
    byParent.set(parent, list);
  }

  let next = layers;
  for (const siblingIds of byParent.values()) {
    next = reorderSiblingsExtreme(next, siblingIds, 'front');
  }
  return next;
}

/** Send selected layers to the back among their siblings (parent-scoped). */
export function sendToBack(layers: CanvasLayer[], ids: string[]): CanvasLayer[] {
  const idSet = new Set(ids);
  const selected = layers.filter((l) => idSet.has(l.id) && !isLocked(l) && l.type !== 'frame');
  if (!selected.length) return layers;

  const byParent = new Map<string | undefined, string[]>();
  for (const layer of selected) {
    const parent = resolvedParentId(layers, layer);
    const list = byParent.get(parent) ?? [];
    list.push(layer.id);
    byParent.set(parent, list);
  }

  let next = layers;
  for (const siblingIds of byParent.values()) {
    next = reorderSiblingsExtreme(next, siblingIds, 'back');
  }
  return next;
}

export function duplicateLayers(
  layers: CanvasLayer[],
  ids: string[],
  options?: { offsetMm?: number },
): { layers: CanvasLayer[]; newIds: string[] } {
  const byId = new Map(layers.map((l) => [l.id, l]));
  const requested = new Set(
    ids.filter((id) => {
      const layer = byId.get(id);
      return layer && !isLocked(layer);
    }),
  );

  const toDuplicate = new Set(expandWithDescendants(layers, [...requested]));
  const offset = options?.offsetMm ?? NUDGE_OFFSET_MM;

  const idMap = new Map<string, string>();
  for (const id of toDuplicate) {
    idMap.set(id, newId());
  }

  const newIds: string[] = [];
  const result: CanvasLayer[] = [];

  for (const layer of layers) {
    result.push(layer);
    if (!toDuplicate.has(layer.id)) continue;

    const dup: CanvasLayer = {
      ...layer,
      id: idMap.get(layer.id)!,
      name: `${layer.name} copia`,
      cssVars: {
        ...layer.cssVars,
        '--translate-x': mm(parseMm(layer.cssVars['--translate-x']) + offset),
        '--translate-y': mm(parseMm(layer.cssVars['--translate-y']) + offset),
      },
      parentId:
        layer.parentId && toDuplicate.has(layer.parentId)
          ? idMap.get(layer.parentId)
          : layer.parentId,
    };
    result.push(dup);
    if (requested.has(layer.id)) newIds.push(dup.id);
  }

  return { layers: result, newIds };
}

/**
 * Reorder dragged among siblings relative to Capas visual order (paint-top-first).
 * Capas "before" = closer to front = later in the document array.
 */
export function reorderAmongSiblings(
  layers: CanvasLayer[],
  draggedId: string,
  targetId: string,
  position: 'before' | 'after',
): CanvasLayer[] {
  if (draggedId === targetId) return layers;
  const dragged = layers.find((l) => l.id === draggedId);
  const target = layers.find((l) => l.id === targetId);
  if (!dragged || !target) return layers;
  if (dragged.type === 'frame' || target.type === 'frame' || isLocked(dragged)) return layers;
  if (resolvedParentId(layers, dragged) !== resolvedParentId(layers, target)) return layers;

  const without = layers.filter((l) => l.id !== draggedId);
  const targetIdx = without.findIndex((l) => l.id === targetId);
  if (targetIdx < 0) return layers;
  const insertAt = position === 'before' ? targetIdx + 1 : targetIdx;
  without.splice(insertAt, 0, dragged);
  return without;
}

/** One step toward front among siblings (later in document). */
export function bringForward(layers: CanvasLayer[], ids: string[]): CanvasLayer[] {
  let next = layers;
  for (const id of ids) {
    const layer = next.find((l) => l.id === id);
    if (!layer || isLocked(layer) || layer.type === 'frame') continue;
    const parent = resolvedParentId(next, layer);
    const siblings = next.filter(
      (l) => l.type !== 'frame' && resolvedParentId(next, l) === parent,
    );
    const idx = siblings.findIndex((l) => l.id === id);
    if (idx < 0 || idx >= siblings.length - 1) continue;
    next = reorderAmongSiblings(next, id, siblings[idx + 1].id, 'before');
  }
  return next;
}

/** One step toward back among siblings (earlier in document). */
export function sendBackward(layers: CanvasLayer[], ids: string[]): CanvasLayer[] {
  let next = layers;
  for (const id of [...ids].reverse()) {
    const layer = next.find((l) => l.id === id);
    if (!layer || isLocked(layer) || layer.type === 'frame') continue;
    const parent = resolvedParentId(next, layer);
    const siblings = next.filter(
      (l) => l.type !== 'frame' && resolvedParentId(next, l) === parent,
    );
    const idx = siblings.findIndex((l) => l.id === id);
    if (idx <= 0) continue;
    next = reorderAmongSiblings(next, id, siblings[idx - 1].id, 'after');
  }
  return next;
}

export function setLayersVisible(layers: CanvasLayer[], ids: string[], visible: boolean): CanvasLayer[] {
  const idSet = new Set(ids);
  return layers.map((layer) => (idSet.has(layer.id) ? { ...layer, visible } : layer));
}

export function setLayersLocked(layers: CanvasLayer[], ids: string[], locked: boolean): CanvasLayer[] {
  const idSet = new Set(ids);
  return layers.map((layer) =>
    idSet.has(layer.id) && layer.type !== 'frame' ? { ...layer, locked } : layer,
  );
}

export function setLayersOpacity(layers: CanvasLayer[], ids: string[], opacity: number): CanvasLayer[] {
  const idSet = new Set(ids);
  const value = `${Math.max(0, Math.min(100, Math.round(opacity)))}%`;
  return layers.map((layer) => {
    if (!idSet.has(layer.id) || isLocked(layer) || layer.type === 'frame') return layer;
    return { ...layer, cssVars: { ...layer.cssVars, '--opacity': value } };
  });
}

export function nudgeLayers(
  layers: CanvasLayer[],
  ids: string[],
  dxMm: number,
  dyMm: number,
): CanvasLayer[] {
  return translateRoots(layers, ids, dxMm, dyMm);
}

/** Remove layers and all descendants linked via parentId. */
export function deleteLayers(layers: CanvasLayer[], ids: string[]): CanvasLayer[] {
  const remove = new Set(expandWithDescendants(layers, ids));
  return layers.filter((l) => !remove.has(l.id));
}

export type AlignMode = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';

/**
 * Align selected layers. Single selection aligns to the page frame
 * (optionally for `pageIndex`). Multi-select aligns to selection bounds.
 * Moving a group also moves its descendants.
 */
export function alignLayers(
  layers: CanvasLayer[],
  ids: string[],
  align: AlignMode,
  options?: { pageIndex?: number },
): CanvasLayer[] {
  const idSet = new Set(ids);
  const targets = layers.filter((l) => idSet.has(l.id) && !isLocked(l) && l.type !== 'frame');
  if (!targets.length) return layers;

  const pageIndex = options?.pageIndex ?? targets[0].pageIndex ?? 0;
  const frame = layers.find((l) => l.type === 'frame' && (l.pageIndex ?? 0) === pageIndex);

  const applyDelta = (rootId: string, targetVisualX: number, targetVisualY: number) => {
    const layer = layers.find((l) => l.id === rootId);
    if (!layer) return { dx: 0, dy: 0 };
    const visual = layerBounds(layer);
    // CSS rotate is around center, so a visual AABB shift equals a local translate shift.
    return {
      dx: targetVisualX - visual.x,
      dy: targetVisualY - visual.y,
    };
  };

  if (targets.length === 1 && frame) {
    const target = targets[0];
    const fb = layerBounds(frame);
    const b = layerBounds(target);
    let vx = b.x;
    let vy = b.y;
    if (align === 'left') vx = fb.x;
    else if (align === 'right') vx = fb.right - b.w;
    else if (align === 'center') vx = fb.x + (fb.w - b.w) / 2;
    else if (align === 'top') vy = fb.y;
    else if (align === 'bottom') vy = fb.bottom - b.h;
    else vy = fb.y + (fb.h - b.h) / 2;
    const { dx, dy } = applyDelta(target.id, vx, vy);
    return translateRoots(layers, [target.id], dx, dy);
  }

  if (targets.length < 2) return layers;

  const bounds = targets.map((l) => ({ layer: l, ...layerBounds(l) }));

  let value = 0;
  if (align === 'left') value = Math.min(...bounds.map((b) => b.x));
  else if (align === 'right') value = Math.max(...bounds.map((b) => b.right));
  else if (align === 'center') {
    const minX = Math.min(...bounds.map((b) => b.x));
    const maxX = Math.max(...bounds.map((b) => b.right));
    value = (minX + maxX) / 2;
  } else if (align === 'top') value = Math.min(...bounds.map((b) => b.y));
  else if (align === 'bottom') value = Math.max(...bounds.map((b) => b.bottom));
  else {
    const minY = Math.min(...bounds.map((b) => b.y));
    const maxY = Math.max(...bounds.map((b) => b.bottom));
    value = (minY + maxY) / 2;
  }

  let next = layers;
  for (const target of targets) {
    const b = layerBounds(target);
    let vx = b.x;
    let vy = b.y;
    if (align === 'left') vx = value;
    else if (align === 'right') vx = value - b.w;
    else if (align === 'center') vx = value - b.w / 2;
    else if (align === 'top') vy = value;
    else if (align === 'bottom') vy = value - b.h;
    else vy = value - b.h / 2;
    const { dx, dy } = applyDelta(target.id, vx, vy);
    next = translateRoots(next, [target.id], dx, dy);
  }
  return next;
}

/**
 * Distribute selected layers (≥3).
 * - `centers` (default): even spacing between centers (legacy).
 * - `gaps`: equal gaps between bounding boxes (Figma-like tidy spacing).
 */
export function distributeLayers(
  layers: CanvasLayer[],
  ids: string[],
  axis: 'horizontal' | 'vertical',
  options?: { mode?: 'centers' | 'gaps' },
): CanvasLayer[] {
  const idSet = new Set(ids);
  const targets = layers.filter((l) => idSet.has(l.id) && !isLocked(l) && l.type !== 'frame');
  if (targets.length < 3) return layers;

  const mode = options?.mode ?? 'gaps';
  const sorted = [...targets].sort((a, b) => {
    const ba = layerBounds(a);
    const bb = layerBounds(b);
    return axis === 'horizontal' ? ba.cx - bb.cx : ba.cy - bb.cy;
  });

  const deltas = new Map<string, { dx: number; dy: number }>();

  if (mode === 'centers') {
    const first = layerBounds(sorted[0]);
    const last = layerBounds(sorted[sorted.length - 1]);
    const span = axis === 'horizontal' ? last.cx - first.cx : last.cy - first.cy;
    const step = span / (sorted.length - 1);
    sorted.forEach((layer, index) => {
      const b = layerBounds(layer);
      if (axis === 'horizontal') {
        const vx = first.cx + step * index - b.w / 2;
        deltas.set(layer.id, { dx: vx - b.x, dy: 0 });
      } else {
        const vy = first.cy + step * index - b.h / 2;
        deltas.set(layer.id, { dx: 0, dy: vy - b.y });
      }
    });
  } else {
    const boxes = sorted.map((l) => ({ id: l.id, ...layerBounds(l) }));
    if (axis === 'horizontal') {
      const first = boxes[0];
      const last = boxes[boxes.length - 1];
      const innerSpan = last.x - (first.x + first.w);
      const middleWidths = boxes.slice(1, -1).reduce((sum, b) => sum + b.w, 0);
      const gap = (innerSpan - middleWidths) / (boxes.length - 1);
      let cursor = first.x + first.w + gap;
      for (let i = 1; i < boxes.length - 1; i += 1) {
        const b = boxes[i];
        deltas.set(b.id, { dx: cursor - b.x, dy: 0 });
        cursor += b.w + gap;
      }
    } else {
      const first = boxes[0];
      const last = boxes[boxes.length - 1];
      const innerSpan = last.y - (first.y + first.h);
      const middleHeights = boxes.slice(1, -1).reduce((sum, b) => sum + b.h, 0);
      const gap = (innerSpan - middleHeights) / (boxes.length - 1);
      let cursor = first.y + first.h + gap;
      for (let i = 1; i < boxes.length - 1; i += 1) {
        const b = boxes[i];
        deltas.set(b.id, { dx: 0, dy: cursor - b.y });
        cursor += b.h + gap;
      }
    }
  }

  let next = layers;
  for (const [id, { dx, dy }] of deltas) {
    next = translateRoots(next, [id], dx, dy);
  }
  return next;
}

export function groupLayers(
  layers: CanvasLayer[],
  ids: string[],
): { layers: CanvasLayer[]; groupId: string } {
  const idSet = new Set(ids);
  const children = layers.filter((l) => idSet.has(l.id) && !isLocked(l) && l.type !== 'frame');
  if (!children.length) return { layers, groupId: '' };

  const bounds = children.map(layerBounds);
  const minX = Math.min(...bounds.map((b) => b.x));
  const minY = Math.min(...bounds.map((b) => b.y));
  const maxX = Math.max(...bounds.map((b) => b.right));
  const maxY = Math.max(...bounds.map((b) => b.bottom));
  const groupId = newId();

  const group: CanvasLayer = {
    id: groupId,
    type: 'group',
    name: 'Grupo',
    value: '',
    cssVars: {
      '--width': mm(maxX - minX),
      '--height': mm(maxY - minY),
      '--translate-x': mm(minX),
      '--translate-y': mm(minY),
      '--background-color': 'transparent',
    },
  };

  const childIds = new Set(children.map((c) => c.id));
  const updated = layers.map((layer) =>
    childIds.has(layer.id) ? { ...layer, parentId: groupId } : layer,
  );

  return { layers: [...updated, group], groupId };
}

export function ungroupLayers(layers: CanvasLayer[], groupId: string): CanvasLayer[] {
  return layers
    .filter((l) => l.id !== groupId)
    .map((layer) => (layer.parentId === groupId ? { ...layer, parentId: undefined } : layer));
}

export function setLayerVisible(layers: CanvasLayer[], id: string, visible: boolean): CanvasLayer[] {
  return setLayersVisible(layers, [id], visible);
}

export function setLayerLocked(layers: CanvasLayer[], id: string, locked: boolean): CanvasLayer[] {
  return setLayersLocked(layers, [id], locked);
}
