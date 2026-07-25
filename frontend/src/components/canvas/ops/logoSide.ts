import type { CanvasLayer } from '../types';

export type LogoSide = 'left' | 'right';

export function logoSideOf(layer: CanvasLayer): LogoSide {
  return layer.meta?.side === 'right' ? 'right' : 'left';
}

/** Prefer an unoccupied side among existing logo layers (excluding optional ids). */
export function nextFreeLogoSide(layers: CanvasLayer[], excludeIds?: ReadonlySet<string>): LogoSide {
  const occupied = new Set<LogoSide>();
  for (const layer of layers) {
    if (layer.type !== 'logo') continue;
    if (excludeIds?.has(layer.id)) continue;
    occupied.add(logoSideOf(layer));
  }
  if (!occupied.has('left')) return 'left';
  if (!occupied.has('right')) return 'right';
  return 'left';
}

export function logoSideLabel(side: LogoSide): string {
  return side === 'right' ? 'Logo derecho' : 'Logo izquierdo';
}

/** True when another logo layer shares the same side. */
export function logoSideHasConflict(layers: CanvasLayer[], layerId: string): boolean {
  const layer = layers.find((l) => l.id === layerId);
  if (!layer || layer.type !== 'logo') return false;
  const side = logoSideOf(layer);
  return layers.some((l) => l.id !== layerId && l.type === 'logo' && logoSideOf(l) === side);
}

/**
 * For newly created/duplicated logos: if their side collides with another logo,
 * move them to the free side when one is available.
 */
export function assignUniqueLogoSides(layers: CanvasLayer[], layerIds: string[]): CanvasLayer[] {
  let next = layers;
  for (const id of layerIds) {
    const layer = next.find((l) => l.id === id);
    if (!layer || layer.type !== 'logo') continue;
    if (!logoSideHasConflict(next, id)) continue;
    const free = nextFreeLogoSide(next, new Set([id]));
    if (free === logoSideOf(layer)) continue;
    next = next.map((l) =>
      l.id === id
        ? {
            ...l,
            name: logoSideLabel(free),
            meta: { ...l.meta, side: free },
          }
        : l,
    );
  }
  return next;
}

export function withAssignedLogoSide(layer: CanvasLayer, layers: CanvasLayer[]): CanvasLayer {
  if (layer.type !== 'logo') return layer;
  const side = nextFreeLogoSide(layers);
  return {
    ...layer,
    name: logoSideLabel(side),
    meta: { ...layer.meta, side },
  };
}
