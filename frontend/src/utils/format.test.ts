import { describe, expect, it } from 'vitest';
import { formatBytes } from './format';

describe('formatBytes', () => {
  it('formatea cero, negativos y no finitos como "0 B"', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(-5)).toBe('0 B');
    expect(formatBytes(Number.NaN)).toBe('0 B');
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe('0 B');
  });

  it('formatea cada unidad con un decimal recortado', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(1024 * 1024)).toBe('1 MB');
    expect(formatBytes(2.25 * 1024 * 1024)).toBe('2.3 MB');
    expect(formatBytes(1024 ** 3)).toBe('1 GB');
  });

  it('satura en GB para valores enormes', () => {
    expect(formatBytes(1024 ** 4)).toBe('1024 GB');
  });
});
