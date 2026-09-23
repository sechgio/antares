import { describe, expect, it, vi } from 'vitest';

const presetState = vi.hoisted(() => ({
  attempts: 0,
  presets: [{ id: 'test', label: 'Test', create: () => ({}) }],
}));

vi.mock('../presets', () => {
  presetState.attempts += 1;
  if (presetState.attempts === 1) throw new Error('transient preset chunk failure');
  return { CANVAS_PRESETS: presetState.presets };
});

import { loadCanvasPresets } from './loadPresets';

describe('loadCanvasPresets', () => {
  it('retries after a transient import failure', async () => {
    await expect(loadCanvasPresets()).rejects.toThrow();
    await expect(loadCanvasPresets()).resolves.toBe(presetState.presets);
    expect(presetState.attempts).toBe(2);
  });
});
