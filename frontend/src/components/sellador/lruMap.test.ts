import { describe, expect, it } from 'vitest';
import {
  createLruMap,
  estimateStringBytes,
  SELLADOR_PREVIEW_CACHE_MAX_BYTES,
} from './lruMap';

describe('createLruMap weighted', () => {
  it('evicts oldest entries when maxEntries is exceeded', () => {
    const cache = createLruMap<string, string>(2);
    cache.set('a', '1');
    cache.set('b', '2');
    cache.set('c', '3');
    expect(cache.size).toBe(2);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe('2');
    expect(cache.get('c')).toBe('3');
  });

  it('evicts by byte budget before entry count', () => {
    const cache = createLruMap<string, string>({
      maxBytes: estimateStringBytes('xx'),
      sizeOf: estimateStringBytes,
    });
    cache.set('a', 'xx');
    cache.set('b', 'xx');
    expect(cache.size).toBe(1);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe('xx');
    expect(cache.bytes).toBeLessThanOrEqual(estimateStringBytes('xx'));
  });

  it('promotes on get so least-recently-used is evicted', () => {
    const cache = createLruMap<string, string>({
      maxBytes: estimateStringBytes('xx'),
      sizeOf: estimateStringBytes,
    });
    cache.set('a', 'xx');
    expect(cache.get('a')).toBe('xx');
    cache.set('b', 'xx');
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe('xx');
  });

  it('refuses to retain a single oversized entry', () => {
    const cache = createLruMap<string, string>({
      maxBytes: 10,
      sizeOf: estimateStringBytes,
    });
    cache.set('small', 'ab');
    cache.set('huge', 'x'.repeat(20));
    expect(cache.get('small')).toBe('ab');
    expect(cache.get('huge')).toBeUndefined();
    expect(cache.size).toBe(1);
  });

  it('exports the 24 MiB sellador preview budget', () => {
    expect(SELLADOR_PREVIEW_CACHE_MAX_BYTES).toBe(24 * 1024 * 1024);
  });
});
