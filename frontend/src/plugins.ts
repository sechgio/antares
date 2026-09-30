import { useSyncExternalStore } from 'react';

export type PluginId = 'sticky-notes' | 'radio-live' | 'spotify' | 'audius' | 'jamendo' | 'archive';

export const PLUGINS_CHANGED_EVENT = 'antares-plugins-changed';

// Radio Live conserva su activación por defecto; los demás plugins requieren activación.
const DEFAULTS: Record<PluginId, boolean> = {
  'sticky-notes': false,
  'radio-live': true,
  spotify: false,
  audius: false,
  jamendo: false,
  archive: false,
};

const storageKey = (id: PluginId): string => `plugin.${id}.enabled`;

// Preferencia de esta sesión cuando el storage falla (modo privado, cuota llena).
const sessionPrefs = new Map<PluginId, boolean>();

export const TITLEBAR_PLUGINS = ['radio-live', 'spotify', 'audius', 'jamendo', 'archive'] as const;
export type TitleBarPluginId = (typeof TITLEBAR_PLUGINS)[number];

const ORDER_STORAGE_KEY = 'plugins.titlebar.order';
let sessionOrder: TitleBarPluginId[] | null = null;
let orderSnapshot: TitleBarPluginId[] | null = null;

// raw puede traer ids ajenos, duplicados o quedarse corto (plugin nuevo tras
// guardar); el orden siempre cubre TITLEBAR_PLUGINS completo, lo nuevo al final.
function normalizeOrder(raw: readonly unknown[]): TitleBarPluginId[] {
  const ordered: TitleBarPluginId[] = [];
  for (const id of raw) {
    const plugin = TITLEBAR_PLUGINS.find((candidate) => candidate === id);
    if (plugin && !ordered.includes(plugin)) ordered.push(plugin);
  }
  for (const id of TITLEBAR_PLUGINS) {
    if (!ordered.includes(id)) ordered.push(id);
  }
  return ordered;
}

export function isPluginEnabled(id: PluginId): boolean {
  try {
    const raw = localStorage.getItem(storageKey(id));
    return raw === null ? (sessionPrefs.get(id) ?? DEFAULTS[id]) : raw === 'true';
  } catch {
    return sessionPrefs.get(id) ?? DEFAULTS[id];
  }
}

export function setPluginEnabled(id: PluginId, enabled: boolean): void {
  try {
    localStorage.setItem(storageKey(id), enabled ? 'true' : 'false');
  } catch {
    // Sin persistencia; la preferencia en memoria sigue aplicándose esta sesión.
    sessionPrefs.set(id, enabled);
  }
  window.dispatchEvent(new CustomEvent(PLUGINS_CHANGED_EVENT));
}

export function getPluginOrder(): TitleBarPluginId[] {
  let stored: unknown = sessionOrder;
  try {
    stored = JSON.parse(localStorage.getItem(ORDER_STORAGE_KEY) ?? 'null') ?? sessionOrder;
  } catch {
    // Sin persistencia; la preferencia en memoria sigue aplicándose esta sesión.
  }
  const next = normalizeOrder(Array.isArray(stored) ? stored : []);
  // Snapshot estable: useSyncExternalStore compara por referencia.
  if (
    !orderSnapshot ||
    orderSnapshot.length !== next.length ||
    orderSnapshot.some((id, i) => id !== next[i])
  ) {
    orderSnapshot = next;
  }
  return orderSnapshot;
}

export function setPluginOrder(order: readonly TitleBarPluginId[]): void {
  const next = normalizeOrder(order);
  try {
    localStorage.setItem(ORDER_STORAGE_KEY, JSON.stringify(next));
  } catch {
    sessionOrder = next;
  }
  window.dispatchEvent(new CustomEvent(PLUGINS_CHANGED_EVENT));
}

function subscribePlugins(cb: () => void): () => void {
  window.addEventListener(PLUGINS_CHANGED_EVENT, cb);
  // 'storage' solo se dispara en los otros documentos del mismo origen: es lo que
  // entera a esta ventana cuando otra ventana activó o desactivó un plugin.
  window.addEventListener('storage', cb);
  return () => {
    window.removeEventListener(PLUGINS_CHANGED_EVENT, cb);
    window.removeEventListener('storage', cb);
  };
}

export function usePluginEnabled(id: PluginId): boolean {
  return useSyncExternalStore(subscribePlugins, () => isPluginEnabled(id));
}

export function usePluginOrder(): TitleBarPluginId[] {
  return useSyncExternalStore(subscribePlugins, getPluginOrder);
}
