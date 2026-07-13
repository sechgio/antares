/**
 * LRU-cached, concurrency-limited local thumbnails for conversion grid.
 * Uses Electron nativeImage via api.localThumbnail (Path A). On any failure
 * returns null so callers fall back to file:// full path.
 */

import { api } from '../api';

const MAX_CACHE = 200;
const CONCURRENCY = 3;
const DEFAULT_MAX_EDGE = 256;

/** key = path + maxEdge → data URL */
const cache = new Map<string, string>();

let active = 0;
const waitQueue: Array<() => void> = [];

function cacheKey(filePath: string, maxEdge: number): string {
  return `${filePath}\0${maxEdge}`;
}

function cacheGet(key: string): string | undefined {
  const hit = cache.get(key);
  if (hit === undefined) return undefined;
  // Refresh LRU order: re-insert at end.
  cache.delete(key);
  cache.set(key, hit);
  return hit;
}

function cacheSet(key: string, dataUrl: string): void {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, dataUrl);
  while (cache.size > MAX_CACHE) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

function runLimited<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const start = () => {
      active += 1;
      fn()
        .then(resolve, reject)
        .finally(() => {
          active -= 1;
          const next = waitQueue.shift();
          if (next) next();
        });
    };
    if (active < CONCURRENCY) start();
    else waitQueue.push(start);
  });
}

/**
 * Resolve a display-size data URL for a local absolute path, or null on failure.
 * Cache hits skip IPC; concurrent in-flight requests are limited to 3.
 */
export async function getLocalThumbnail(
  filePath: string,
  maxEdge: number = DEFAULT_MAX_EDGE,
): Promise<string | null> {
  if (typeof filePath !== 'string' || !filePath.trim()) return null;

  const edge = Number.isFinite(maxEdge) && maxEdge > 0 ? Math.floor(maxEdge) : DEFAULT_MAX_EDGE;
  const key = cacheKey(filePath, edge);
  const hit = cacheGet(key);
  if (hit) return hit;

  try {
    const result = await runLimited(() => api.localThumbnail({ path: filePath, maxEdge: edge }));
    if (result && typeof result.dataUrl === 'string' && result.dataUrl.startsWith('data:')) {
      cacheSet(key, result.dataUrl);
      return result.dataUrl;
    }
    return null;
  } catch {
    return null;
  }
}

/** Test helper — clears cache and pending concurrency queue. */
export function _resetLocalThumbForTests(): void {
  cache.clear();
  waitQueue.length = 0;
  active = 0;
}
