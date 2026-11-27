import { useState } from 'react';
import type { TabId } from '../navigation';

// Keep-alive es opt-in por vista: algunas vistas no toleran seguir montadas
// mientras están ocultas, así que la lista blanca crece solo tras validarlas.
export const KEEP_ALIVE_VIEWS: ReadonlySet<TabId> = new Set<TabId>(['espacios', 'convert']);
export const KEEP_ALIVE_LIMIT = 3;

export function bumpKeepAliveOrder(order: readonly TabId[], tab: TabId, limit: number = KEEP_ALIVE_LIMIT): TabId[] {
  return [tab, ...order.filter((entry) => entry !== tab)].slice(0, limit);
}

export function useKeepAliveViews(activeTab: TabId): readonly TabId[] {
  const [order, setOrder] = useState<TabId[]>([]);
  if (KEEP_ALIVE_VIEWS.has(activeTab) && order[0] !== activeTab) {
    setOrder(bumpKeepAliveOrder(order, activeTab));
  }
  return order;
}
