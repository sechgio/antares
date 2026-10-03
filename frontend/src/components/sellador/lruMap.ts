
export const SELLADOR_PREVIEW_CACHE_MAX_BYTES = 24 * 1024 * 1024;

export function estimateStringBytes(value: string): number {
  return value.length * 2;
}

export function hashPdfBase64(value: string): string {
  let first = 2166136261;
  let second = 2246822519;
  for (let i = 0; i < value.length; i += 1) {
    const char = value.charCodeAt(i);
    first = Math.imul(first ^ char, 16777619);
    second = Math.imul(second ^ char, 3266489917);
  }
  return `${value.length}:${(first >>> 0).toString(16)}:${(second >>> 0).toString(16)}`;
}

export function createObjectIdentity<T extends object>(): (value: T) => number {
  let nextIdentity = 1;
  const identities = new WeakMap<T, number>();

  return (value: T): number => {
    const existing = identities.get(value);
    if (existing !== undefined) return existing;
    const identity = nextIdentity;
    nextIdentity += 1;
    identities.set(value, identity);
    return identity;
  };
}

type LruMapOptions<V> = {
  maxEntries?: number;
  maxBytes?: number;
  sizeOf?: (value: V) => number;
};

type LruMap<K, V> = {
  get(key: K): V | undefined;
  set(key: K, value: V): void;
  delete(key: K): boolean;
  clear(): void;
  readonly size: number;
  readonly bytes: number;
  keys(): IterableIterator<K>;
};

export function createLruMap<K, V>(
  maxEntriesOrOptions: number | LruMapOptions<V>,
  maybeOptions?: LruMapOptions<V>,
): LruMap<K, V> {
  const options: LruMapOptions<V> =
    typeof maxEntriesOrOptions === 'number'
      ? { maxEntries: maxEntriesOrOptions, ...maybeOptions }
      : { ...maxEntriesOrOptions };

  const maxEntries = options.maxEntries ?? Number.POSITIVE_INFINITY;
  const maxBytes = options.maxBytes ?? Number.POSITIVE_INFINITY;
  const sizeOf = options.sizeOf ?? (() => 0);

  const map = new Map<K, V>();
  const weights = new Map<K, number>();
  let totalBytes = 0;

  function forget(key: K): void {
    const weight = weights.get(key) ?? 0;
    totalBytes = Math.max(0, totalBytes - weight);
    weights.delete(key);
    map.delete(key);
  }

  function evictWhileOverBudget(): void {
    while (
      (map.size > maxEntries || totalBytes > maxBytes)
      && map.size > 0
    ) {
      const oldest = map.keys().next().value;
      if (oldest === undefined) break;
      forget(oldest);
    }
  }

  return {
    get(key: K): V | undefined {
      if (!map.has(key)) return undefined;
      const value = map.get(key) as V;
      const weight = weights.get(key) ?? 0;
      map.delete(key);
      weights.delete(key);
      map.set(key, value);
      weights.set(key, weight);
      return value;
    },
    set(key: K, value: V): void {
      if (map.has(key)) forget(key);
      const weight = Math.max(0, sizeOf(value));
      if (weight > maxBytes && Number.isFinite(maxBytes)) {
        return;
      }
      map.set(key, value);
      weights.set(key, weight);
      totalBytes += weight;
      evictWhileOverBudget();
    },
    delete(key: K): boolean {
      if (!map.has(key)) return false;
      forget(key);
      return true;
    },
    clear(): void {
      map.clear();
      weights.clear();
      totalBytes = 0;
    },
    get size(): number {
      return map.size;
    },
    get bytes(): number {
      return totalBytes;
    },
    keys(): IterableIterator<K> {
      return map.keys();
    },
  };
}

export const selladorPreviewCache = createLruMap<string, string>({
  maxBytes: SELLADOR_PREVIEW_CACHE_MAX_BYTES,
  sizeOf: estimateStringBytes,
});
