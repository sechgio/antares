import { describe, expect, it } from 'vitest';
import { hasCanvasFlushOwner, registerCanvasFlushOwner } from './ackCanvasFlush';

describe('canvas flush ownership', () => {
  it('tracks owners and ignores a repeated release', () => {
    expect(hasCanvasFlushOwner()).toBe(false);
    const first = registerCanvasFlushOwner();
    const second = registerCanvasFlushOwner();
    first();
    first();
    expect(hasCanvasFlushOwner()).toBe(true);
    second();
    expect(hasCanvasFlushOwner()).toBe(false);
  });
});
