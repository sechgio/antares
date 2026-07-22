import type { CanvasLayer } from '../types';
import { mm, newId, parseMm } from '../types';
import { expandWithDescendants } from './layerTree';

const NUDGE_OFFSET_MM = 5;

function layerBounds(layer: CanvasLayer) {
  const x = parseMm(layer.cssVars['--translate-x']);
  const y = parseMm(layer.cssVars['--translate-y']);
  const w = parseMm(layer.cssVars['--width'], 10);
  const h = parseMm(layer.cssVars['--height'], 10);
  return { x, y, w, h, right: x + w, bottom: y + h, cx: x + w / 2, cy: y + h / 2 };
}

function isLocked(layer: CanvasLayer): boolean {
  return Boolean(layer.locked);
}

function partitionLayers(layers: CanvasLayer[], ids: Set<string>) {
  const frame = layers.find((l) => l.type === 'frame');
  const selected = layers.filter((l) => ids.has(l.id) && !isLocked(l));
  const rest = layers.filter((l) => !ids.has(l.id) || isLocked(l));
  return { frame, selected, rest };
}

export function duplicateLayers(
  layers: CanvasLayer[],
  ids: string[],
): { layers: CanvasLayer[]; newIds: string[] } {
  const requested = new Set(ids.filter((id) => {
    const layer = layers.find((l) => l.id === id);
    return layer && !isLocked(layer);
  }));

  const toDuplicate = new Set(requested);
  for (const id of requested) {
    const layer = layers.find((l) => l.id === id);
    if (layer?.type === 'group') {
      layers.filter((l) => l.parentId === id).forEach((child) => toDuplicate.add(child.id));
    }
  }

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
        '--translate-x': mm(parseMm(layer.cssVars['--translate-x']) + NUDGE_OFFSET_MM),
        '--translate-y': mm(parseMm(layer.cssVars['--translate-y']) + NUDGE_OFFSET_MM),
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

export function bringToFront(layers: CanvasLayer[], ids: string[]): CanvasLayer[] {
  const { frame, selected, rest } = partitionLayers(layers, new Set(ids));
  if (!selected.length) return layers;
  const withoutFrame = rest.filter((l) => l.type !== 'frame');
  return frame ? [frame, ...withoutFrame, ...selected] : [...rest, ...selected];
}

export function sendToBack(layers: CanvasLayer[], ids: string[]): CanvasLayer[] {
  const { frame, selected, rest } = partitionLayers(layers, new Set(ids));
  if (!selected.length) return layers;
  if (!frame) return [...selected, ...rest];
  const afterFrame = rest.filter((l) => l.type !== 'frame');
  return [frame, ...selected, ...afterFrame];
}

export function reorderLayer(layers: CanvasLayer[], fromIndex: number, toIndex: number): CanvasLayer[] {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return layers;
  if (fromIndex >= layers.length || toIndex >= layers.length) return layers;
  const next = [...layers];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

function resolvedParentId(layers: CanvasLayer[], layer: CanvasLayer): string | undefined {
  return layer.parentId && layers.some((l) => l.id === layer.parentId) ? layer.parentId : undefined;
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
  const roots = new Set(ids);
  const idSet = new Set(expandWithDescendants(layers, ids));
  return layers.map((layer) => {
    if (!idSet.has(layer.id) || layer.type === 'frame') return layer;
    if (roots.has(layer.id) && isLocked(layer)) return layer;
    return {
      ...layer,
      cssVars: {
        ...layer.cssVars,
        '--translate-x': mm(parseMm(layer.cssVars['--translate-x']) + dxMm),
        '--translate-y': mm(parseMm(layer.cssVars['--translate-y']) + dyMm),
      },
    };
  });
}

/** Remove layers and all descendants linked via parentId. */
export function deleteLayers(layers: CanvasLayer[], ids: string[]): CanvasLayer[] {
  const remove = new Set(expandWithDescendants(layers, ids));
  return layers.filter((l) => !remove.has(l.id));
}

export function alignLayers(
  layers: CanvasLayer[],
  ids: string[],
  align: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom',
): CanvasLayer[] {
  const idSet = new Set(ids);
  const targets = layers.filter((l) => idSet.has(l.id) && !isLocked(l));
  if (!targets.length) return layers;

  const frame = layers.find((l) => l.type === 'frame');

  // Single selection: align to frame bounds
  if (targets.length === 1 && frame) {
    const target = targets[0];
    const fb = layerBounds(frame);
    const b = layerBounds(target);
    let x = b.x;
    let y = b.y;
    if (align === 'left') x = fb.x;
    else if (align === 'right') x = fb.right - b.w;
    else if (align === 'center') x = fb.x + (fb.w - b.w) / 2;
    else if (align === 'top') y = fb.y;
    else if (align === 'bottom') y = fb.bottom - b.h;
    else y = fb.y + (fb.h - b.h) / 2;
    return layers.map((layer) => {
      if (layer.id !== target.id) return layer;
      return {
        ...layer,
        cssVars: {
          ...layer.cssVars,
          '--translate-x': mm(x),
          '--translate-y': mm(y),
        },
      };
    });
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

  return layers.map((layer) => {
    if (!idSet.has(layer.id) || isLocked(layer)) return layer;
    const b = layerBounds(layer);
    let x = b.x;
    let y = b.y;
    if (align === 'left') x = value;
    else if (align === 'right') x = value - b.w;
    else if (align === 'center') x = value - b.w / 2;
    else if (align === 'top') y = value;
    else if (align === 'bottom') y = value - b.h;
    else y = value - b.h / 2;
    return {
      ...layer,
      cssVars: {
        ...layer.cssVars,
        '--translate-x': mm(x),
        '--translate-y': mm(y),
      },
    };
  });
}

export function distributeLayers(
  layers: CanvasLayer[],
  ids: string[],
  axis: 'horizontal' | 'vertical',
): CanvasLayer[] {
  const idSet = new Set(ids);
  const targets = layers.filter((l) => idSet.has(l.id) && !isLocked(l));
  if (targets.length < 3) return layers;

  const sorted = [...targets].sort((a, b) => {
    const ba = layerBounds(a);
    const bb = layerBounds(b);
    return axis === 'horizontal' ? ba.cx - bb.cx : ba.cy - bb.cy;
  });

  const first = layerBounds(sorted[0]);
  const last = layerBounds(sorted[sorted.length - 1]);
  const span = axis === 'horizontal' ? last.cx - first.cx : last.cy - first.cy;
  const step = span / (sorted.length - 1);

  const positions = new Map<string, number>();
  sorted.forEach((layer, index) => {
    const b = layerBounds(layer);
    positions.set(layer.id, axis === 'horizontal' ? first.cx + step * index - b.w / 2 : first.cy + step * index - b.h / 2);
  });

  return layers.map((layer) => {
    if (!positions.has(layer.id)) return layer;
    const b = layerBounds(layer);
    const pos = positions.get(layer.id)!;
    return {
      ...layer,
      cssVars: {
        ...layer.cssVars,
        '--translate-x': mm(axis === 'horizontal' ? pos : b.x),
        '--translate-y': mm(axis === 'vertical' ? pos : b.y),
      },
    };
  });
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
