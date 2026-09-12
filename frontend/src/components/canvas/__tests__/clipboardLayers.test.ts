import { describe, expect, it } from 'vitest';
import {
  applyAppearanceVars,
  createClipboardCopyCoordinator,
  extractAppearanceVars,
  parseClipboardLayers,
  pasteToReplaceLayers,
} from '../ops/clipboardLayers';
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

describe('appearance vars (copy/paste properties)', () => {
  it('extractAppearanceVars strips geometry and keeps style keys', () => {
    const layer = createLayer('rect', {
      id: 'r1',
      cssVars: {
        '--translate-x': '10mm',
        '--translate-y': '20mm',
        '--width': '40mm',
        '--height': '12mm',
        '--rotate': '15',
        '--background-color': '#3366FF',
        '--border-color': '#FF0000',
        '--opacity': '80',
      },
    });
    const appearance = extractAppearanceVars(layer.cssVars);
    expect(appearance['--background-color']).toBe('#3366FF');
    expect(appearance['--border-color']).toBe('#FF0000');
    expect(appearance['--opacity']).toBe('80');
    expect(appearance['--translate-x']).toBeUndefined();
    expect(appearance['--translate-y']).toBeUndefined();
    expect(appearance['--width']).toBeUndefined();
    expect(appearance['--height']).toBeUndefined();
    expect(appearance['--rotate']).toBeUndefined();
  });

  it('applyAppearanceVars merges onto selected layers and skips locked/frame', () => {
    const a = createLayer('rect', { id: 'a' });
    const b = { ...createLayer('rect', { id: 'b' }), locked: true };
    const c = createLayer('rect', { id: 'c' });
    const appearance = { '--background-color': '#00FF00' } as const;

    const next = applyAppearanceVars([a, b, c], appearance, ['a', 'b', 'c']);

    expect(next.find((l) => l.id === 'a')!.cssVars['--background-color']).toBe('#00FF00');
    expect(next.find((l) => l.id === 'b')!.cssVars['--background-color']).not.toBe('#00FF00');
    expect(next.find((l) => l.id === 'c')!.cssVars['--background-color']).toBe('#00FF00');
    expect(next.find((l) => l.id === 'a')!.cssVars['--translate-x']).toBe(
      a.cssVars['--translate-x'],
    );
  });

  it('applyAppearanceVars no-ops on empty ids or empty appearance', () => {
    const a = createLayer('rect', { id: 'a' });
    expect(applyAppearanceVars([a], { '--background-color': '#FFF' }, [])).toEqual([a]);
    expect(applyAppearanceVars([a], {}, ['a'])).toEqual([a]);
  });
});

describe('pasteToReplaceLayers', () => {
  const at = (id: string, x: number, y: number, extra: Record<string, string> = {}) =>
    createLayer('rect', {
      id,
      cssVars: {
        ...createLayer('rect').cssVars,
        '--translate-x': `${x}mm`,
        '--translate-y': `${y}mm`,
        '--width': '20mm',
        '--height': '10mm',
        ...extra,
      },
    });

  it('removes the target and lands the clipboard bbox at its position', () => {
    const target = at('target', 50, 60);
    const incoming = at('clip', 0, 0);
    const result = pasteToReplaceLayers([target], [incoming], ['target'])!;

    expect(result.layers.find((l) => l.id === 'target')).toBeUndefined();
    expect(result.layers).toHaveLength(1);
    const pasted = result.layers[0]!;
    expect(pasted.id).not.toBe('clip');
    expect(pasted.cssVars['--translate-x']).toBe('50mm');
    expect(pasted.cssVars['--translate-y']).toBe('60mm');
    expect(result.newIds).toEqual([pasted.id]);
  });

  it('reparents children with regenerated ids and keeps hierarchy', () => {
    const target = at('target', 10, 10);
    const parent = createLayer('group', {
      id: 'g',
      cssVars: {
        '--translate-x': '0mm',
        '--translate-y': '0mm',
        '--width': '40mm',
        '--height': '40mm',
      },
    });
    const child = at('c', 5, 5);
    child.parentId = 'g';
    const result = pasteToReplaceLayers([target], [parent, child], ['target'])!;

    expect(result.layers).toHaveLength(2);
    const newParent = result.layers.find((l) => l.type === 'group')!;
    const newChild = result.layers.find((l) => l.type === 'rect')!;
    expect(newChild.parentId).toBe(newParent.id);
    expect(newParent.pageIndex).toBe(0);
    expect(result.newIds).toEqual([newParent.id]);
  });

  it('returns null with no valid targets or empty clipboard', () => {
    const locked = { ...at('t', 0, 0), locked: true };
    expect(pasteToReplaceLayers([locked], [at('c', 0, 0)], ['t'])).toBeNull();
    expect(pasteToReplaceLayers([locked], [], ['t'])).toBeNull();
    expect(pasteToReplaceLayers([locked], [at('c', 0, 0)], [])).toBeNull();
  });

  it('dedupes incoming layers that share an id', () => {
    const target = at('target', 10, 10);
    const result = pasteToReplaceLayers(
      [target],
      [at('dup', 0, 0), at('dup', 5, 5)],
      ['target'],
    )!;
    const ids = result.layers.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(result.layers).toHaveLength(1);
  });

  it('remaps instanceOf and componentId to regenerated ids inside the pasted set', () => {
    const target = at('target', 0, 0);
    const master = createLayer('component', {
      id: 'm',
      cssVars: at('m', 0, 0).cssVars,
    });
    master.meta = { componentId: 'm', variants: {} };
    const inst = at('i', 5, 5);
    inst.meta = { instanceOf: 'm', variant: 'a', variantProps: { k: 'v' } };

    const result = pasteToReplaceLayers([target], [master, inst], ['target'])!;
    const newMaster = result.layers.find((l) => l.type === 'component')!;
    const newInst = result.layers.find((l) => l.type === 'rect')!;
    expect(newInst.meta?.instanceOf).toBe(newMaster.id);
    expect(newInst.meta?.variant).toBe('a');
    expect(newMaster.meta?.componentId).toBe(newMaster.id);
  });

  it('strips a dangling instanceOf when the master is absent from the target doc', () => {
    const target = at('target', 0, 0);
    const inst = at('i', 5, 5);
    inst.meta = { instanceOf: 'gone-master', variant: 'a', variantProps: { k: 'v' } };

    const result = pasteToReplaceLayers([target], [inst], ['target'])!;
    const pasted = result.layers[0]!;
    expect(pasted.meta?.instanceOf).toBeUndefined();
    expect(pasted.meta?.variant).toBeUndefined();
    expect(pasted.meta?.variantProps).toBeUndefined();
  });

  it('keeps instanceOf when the master still exists in the target document', () => {
    const target = at('target', 0, 0);
    const master = at('m', 100, 100);
    const inst = at('i', 5, 5);
    inst.meta = { instanceOf: 'm' };

    const result = pasteToReplaceLayers([target, master], [inst], ['target'])!;
    const pasted = result.layers.find((l) => l.id !== 'm')!;
    expect(pasted.meta?.instanceOf).toBe('m');
  });
});
