import { describe, expect, it } from 'vitest';
import { parseClipboardLayers, createClipboardCopyCoordinator } from '../ops/clipboardLayers';
import { createLayer } from '../constants';

describe('parseClipboardLayers', () => {
  it('parses a valid layer array', () => {
    const layer = createLayer('rect', { id: 'r1', name: 'Caja' });
    const parsed = parseClipboardLayers(JSON.stringify([layer]));
    expect(parsed).toHaveLength(1);
    expect(parsed?.[0]?.id).toBe('r1');
    expect(parsed?.[0]?.type).toBe('rect');
    expect(parsed?.[0]?.cssVars).toBeTruthy();
  });

  it('returns null for invalid JSON or non-array', () => {
    expect(parseClipboardLayers('')).toBeNull();
    expect(parseClipboardLayers('not-json')).toBeNull();
    expect(parseClipboardLayers('{}')).toBeNull();
    expect(parseClipboardLayers('[]')).toBeNull();
  });

  it('rejects items missing type or cssVars', () => {
    expect(parseClipboardLayers(JSON.stringify([{ id: 'x', cssVars: {} }]))).toBeNull();
    expect(parseClipboardLayers(JSON.stringify([{ type: 'rect' }]))).toBeNull();
    expect(parseClipboardLayers(JSON.stringify([{ type: 'rect', cssVars: null }]))).toBeNull();
    expect(parseClipboardLayers(JSON.stringify([{ type: 'rect', cssVars: [] }]))).toBeNull();
    expect(parseClipboardLayers(JSON.stringify([null]))).toBeNull();
  });

  it('accepts multiple valid layers', () => {
    const a = createLayer('polygon', { id: 'a', name: 'A' });
    const b = createLayer('star', { id: 'b', name: 'B' });
    const parsed = parseClipboardLayers(JSON.stringify([a, b]));
    expect(parsed?.map((l) => l.type)).toEqual(['polygon', 'star']);
  });
});

describe('createClipboardCopyCoordinator', () => {
  it('keeps the newest async copy when results resolve out of order', async () => {
    const immediate: string[] = [];
    const resolved: string[] = [];
    const released: string[] = [];
    const pending: Array<(result: { layers: any[]; createdUrls: string[] }) => void> = [];
    const coordinator = createClipboardCopyCoordinator(
      (layers) => immediate.push(String(layers[0]?.id)),
      (layers) => resolved.push(String(layers[0]?.id)),
      (url) => released.push(url),
    );
    const layerA = { id: 'a' } as any;
    const layerB = { id: 'b' } as any;

    coordinator.copy([layerA], () => new Promise((resolve) => pending.push(resolve)));
    coordinator.copy([layerB], () => new Promise((resolve) => pending.push(resolve)));
    await Promise.resolve();
    await Promise.resolve();
    pending[1]!({ layers: [{ id: 'b' }], createdUrls: ['blob:b'] });
    await Promise.resolve();
    pending[0]!({ layers: [{ id: 'a' }], createdUrls: ['blob:a'] });
    await Promise.resolve();
    await Promise.resolve();

    expect(immediate).toEqual(['a', 'b']);
    expect(resolved).toEqual(['b']);
    expect(released).toEqual(['blob:a']);
  });

  it('releases active URLs when invalidated', async () => {
    const released: string[] = [];
    let resolveCopy!: (result: { layers: any[]; createdUrls: string[] }) => void;
    const coordinator = createClipboardCopyCoordinator(
      () => {},
      () => {},
      (url) => released.push(url),
    );

    const copyDone = coordinator.copy([], () => new Promise((resolve) => { resolveCopy = resolve; }));
    await Promise.resolve();
    resolveCopy({ layers: [], createdUrls: ['blob:active'] });
    await copyDone;
    coordinator.invalidate();

    expect(released).toEqual(['blob:active']);
  });
});
