/**
 * Tiny Map-backed LRU for sellador preview data-URL caches.
 * Evicts oldest insertion-order keys when size exceeds maxSize.
 */
export function createLruMap<K, V>(maxSize: number) {
  const map = new Map<K, V>();

  return {
    get(key: K): V | undefined {
      if (!map.has(key)) return undefined;
      const value = map.get(key) as V;
      map.delete(key);
      map.set(key, value);
      return value;
    },
    set(key: K, value: V): void {
      if (map.has(key)) map.delete(key);
      map.set(key, value);
      while (map.size > maxSize) {
        const oldest = map.keys().next().value;
        if (oldest === undefined) break;
        map.delete(oldest);
      }
    },
    delete(key: K): boolean {
      return map.delete(key);
    },
    clear(): void {
      map.clear();
    },
    get size(): number {
      return map.size;
    },
    keys(): IterableIterator<K> {
      return map.keys();
    },
  };
}
