/**
 * LRU-cached, concurrency-limited local thumbnails for conversion grid.
 * Uses Electron nativeImage via api.localThumbnail (Path A). On any failure
 * returns null so callers can show a placeholder (file:// is CSP-blocked).
 *
 * Also exposes getLocalImageDataUrl for full-fidelity CSP-safe previews
 * (e.g. Ubicaciones composed maps written to disk by the backend).
 */

import { api } from '../api';
import { registerLocalPath } from './registerLocalPath';

const MAX_CACHE = 200;
const MIN_CONCURRENCY = 4;
const MAX_CONCURRENCY = 8;
const DEFAULT_MAX_EDGE = 256;
const FULL_IMAGE_CACHE_PREFIX = 'full\0';

/** key = path + maxEdge → data URL (thumbs); full\0path → full image */
const cache = new Map<string, string>();

/** Coalesce concurrent requests for the same key into one IPC call. */
const inFlight = new Map<string, Promise<string | null>>();

let active = 0;
const waitQueue: Array<() => void> = [];

function resolveConcurrency(): number {
  try {
    const cores =
      typeof navigator !== 'undefined' && typeof navigator.hardwareConcurrency === 'number'
        ? navigator.hardwareConcurrency
        : MIN_CONCURRENCY;
    return Math.min(MAX_CONCURRENCY, Math.max(MIN_CONCURRENCY, cores || MIN_CONCURRENCY));
  } catch {
    return MIN_CONCURRENCY;
  }
}

const CONCURRENCY = resolveConcurrency();

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
 * Cache hits skip IPC; concurrent requests for the same key share one in-flight
 * promise; distinct keys are limited by adaptive concurrency (4–8).
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

  const existing = inFlight.get(key);
  if (existing) return existing;

  const promise = (async (): Promise<string | null> => {
    try {
      // Allowlist must be registered before local_thumbnail asserts the path.
      await registerLocalPath(filePath);
      const result = await runLimited(() => api.localThumbnail({ path: filePath, maxEdge: edge }));
      if (result && typeof result.dataUrl === 'string' && result.dataUrl.startsWith('data:')) {
        cacheSet(key, result.dataUrl);
        return result.dataUrl;
      }
      return null;
    } catch {
      return null;
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, promise);
  return promise;
}

/**
 * Resolve a full-fidelity data URL for an allowlisted local image path.
 * Used when the backend returns a disk JPEG/file URI that cannot be used as
 * <img src> under Electron CSP (img-src has no file:).
 */
export async function getLocalImageDataUrl(filePath: string): Promise<string | null> {
  if (typeof filePath !== 'string' || !filePath.trim()) return null;

  const key = `${FULL_IMAGE_CACHE_PREFIX}${filePath}`;
  const hit = cacheGet(key);
  if (hit) return hit;

  const existing = inFlight.get(key);
  if (existing) return existing;

  const promise = (async (): Promise<string | null> => {
    try {
      await registerLocalPath(filePath);
      const result = await runLimited(() => api.localImageDataUrl({ path: filePath }));
      if (result && typeof result.dataUrl === 'string' && result.dataUrl.startsWith('data:')) {
        cacheSet(key, result.dataUrl);
        return result.dataUrl;
      }
      return null;
    } catch {
      return null;
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, promise);
  return promise;
}

/** Test helper — clears cache, in-flight map, and pending concurrency queue. */
export function _resetLocalThumbForTests(): void {
  cache.clear();
  inFlight.clear();
  waitQueue.length = 0;
  active = 0;
}
