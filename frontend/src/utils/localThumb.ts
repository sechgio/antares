
import { api } from '../api';

const MAX_CACHE = 200;
const MIN_CONCURRENCY = 4;
const MAX_CONCURRENCY = 8;
const DEFAULT_MAX_EDGE = 256;
const FULL_IMAGE_CACHE_PREFIX = 'full\0';

const cache = new Map<string, string>();

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

function localImageRequest(fileRef: string, maxEdge?: number): { path?: string; file_token?: string; maxEdge?: number } {
  return fileRef.startsWith('antares-read_')
    ? { file_token: fileRef, maxEdge }
    : { path: fileRef, maxEdge };
}

function localImageDataRequest(fileRef: string): { path?: string; file_token?: string } {
  return fileRef.startsWith('antares-read_')
    ? { file_token: fileRef }
    : { path: fileRef };
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
      const result = await runLimited(() => api.localThumbnail(localImageRequest(filePath, edge)));
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

export async function getLocalImageDataUrl(filePath: string): Promise<string | null> {
  if (typeof filePath !== 'string' || !filePath.trim()) return null;

  const key = `${FULL_IMAGE_CACHE_PREFIX}${filePath}`;
  const hit = cacheGet(key);
  if (hit) return hit;

  const existing = inFlight.get(key);
  if (existing) return existing;

  const promise = (async (): Promise<string | null> => {
    try {
      const result = await runLimited(() => api.localImageDataUrl(localImageDataRequest(filePath)));
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

export function _resetLocalThumbForTests(): void {
  cache.clear();
  inFlight.clear();
  waitQueue.length = 0;
  active = 0;
}
