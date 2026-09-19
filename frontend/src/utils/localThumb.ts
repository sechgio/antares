
import { api } from '../api';
import { createConcurrencyLimiter } from './concurrency';

const MAX_CACHE = 200;
const MAX_CACHE_PAYLOAD_CHARS = 32 * 1024 * 1024;
const MIN_CONCURRENCY = 4;
const MAX_CONCURRENCY = 8;
const DEFAULT_MAX_EDGE = 256;
const FULL_IMAGE_CACHE_PREFIX = 'full\0';
const READ_TOKEN_PREFIX = 'antares-read_';

const cache = new Map<string, string>();
let cachePayloadChars = 0;

const inFlight = new Map<string, Promise<string | null>>();

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

const runLimited = createConcurrencyLimiter(resolveConcurrency());

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
  const payloadChars = dataUrl.length;
  if (payloadChars > MAX_CACHE_PAYLOAD_CHARS) return;
  const previous = cache.get(key);
  if (previous !== undefined) {
    cachePayloadChars -= previous.length;
    cache.delete(key);
  }
  cache.set(key, dataUrl);
  cachePayloadChars += payloadChars;
  while (cache.size > MAX_CACHE || cachePayloadChars > MAX_CACHE_PAYLOAD_CHARS) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    const evicted = cache.get(oldest);
    cache.delete(oldest);
    if (evicted !== undefined) cachePayloadChars -= evicted.length;
  }
}

function localImageRequest(fileRef: string, maxEdge?: number): { path?: string; file_token?: string; maxEdge?: number } {
  return fileRef.startsWith(READ_TOKEN_PREFIX)
    ? { file_token: fileRef, maxEdge }
    : { path: fileRef, maxEdge };
}

function localImageDataRequest(fileRef: string): { path?: string; file_token?: string } {
  return fileRef.startsWith(READ_TOKEN_PREFIX)
    ? { file_token: fileRef }
    : { path: fileRef };
}

async function loadCachedDataUrl(
  key: string,
  request: () => Promise<{ dataUrl: string } | null>,
): Promise<string | null> {
  const hit = cacheGet(key);
  if (hit) return hit;

  const existing = inFlight.get(key);
  if (existing) return existing;

  const promise = (async (): Promise<string | null> => {
    try {
      const result = await runLimited(request);
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

export async function getLocalThumbnail(
  filePath: string,
  maxEdge: number = DEFAULT_MAX_EDGE,
): Promise<string | null> {
  if (typeof filePath !== 'string' || !filePath.trim()) return null;

  const edge = Number.isFinite(maxEdge) && maxEdge > 0 ? Math.floor(maxEdge) : DEFAULT_MAX_EDGE;
  return loadCachedDataUrl(cacheKey(filePath, edge), () =>
    api.localThumbnail(localImageRequest(filePath, edge)),
  );
}

export async function getLocalImageDataUrl(filePath: string): Promise<string | null> {
  if (typeof filePath !== 'string' || !filePath.trim()) return null;

  return loadCachedDataUrl(`${FULL_IMAGE_CACHE_PREFIX}${filePath}`, () =>
    api.localImageDataUrl(localImageDataRequest(filePath)),
  );
}

export function _resetLocalThumbForTests(): void {
  cache.clear();
  cachePayloadChars = 0;
  inFlight.clear();
  runLimited.reset();
}
