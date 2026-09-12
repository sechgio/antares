import { describe, expect, it } from 'vitest';
import { createLayer } from '../constants';
import { cloneDocument, cloneDocumentBaseline } from '../ops/document';
import { ancestorIds, buildLayerTree, expandWithDescendants, flattenLayerTree } from '../ops/layerTree';
import { layerVirtualWindow } from '../ops/layerListWindow';
import { setActivePageLayers } from '../ops/pages';
import { patchLayersById, replaceLayerById } from '../ops/patchLayers';
import { moveSelection, rotateSelection } from '../ops/selectionTransform';
import { selectLayersByIds } from '../ops/mixedSelection';
import type { CanvasDocument } from '../types';

function makeLayers(n: number) {
  return Array.from({ length: n }, (_, i) =>
    createLayer('rect', {
      id: `l${i}`,
      cssVars: {
        '--translate-x': `${(i % 20) * 10}mm`,
        '--translate-y': `${Math.floor(i / 20) * 10}mm`,
        '--width': '8mm',
        '--height': '8mm',
      },
    }),
  );
}

describe('canvas perf hot path', () => {
  it('moveSelection preserves identity of untouched layers (300)', () => {
    const layers = makeLayers(300);
    const next = moveSelection(layers, ['l0'], 2, 1);
    expect(next).not.toBe(layers);
    let same = 0;
    for (let i = 0; i < layers.length; i++) {
      if (next[i] === layers[i]) same += 1;
    }
    expect(same).toBe(299);
    expect(next[0]).not.toBe(layers[0]);
  });

  it('selectLayersByIds handles large selections with set membership', () => {
    const layers = makeLayers(10_000);
    const selectedIds = Array.from({ length: 1_000 }, (_, index) => `l${index * 3}`);
    const t0 = performance.now();
    const selected = selectLayersByIds(layers, selectedIds);
    const elapsed = performance.now() - t0;

    expect(selected).toHaveLength(selectedIds.length);
    expect(selected[0]?.id).toBe('l0');
    expect(selected.at(-1)?.id).toBe('l2997');
    expect(elapsed).toBeLessThan(50);
  });

  it('moveSelection zero delta returns same array ref', () => {
    const layers = makeLayers(50);
    expect(moveSelection(layers, ['l0'], 0, 0)).toBe(layers);
  });

  it('expandWithDescendants on deep tree includes all descendants', () => {
    const layers = [];
    for (let i = 0; i < 80; i++) {
      layers.push(
        createLayer(i === 0 ? 'group' : i % 5 === 0 ? 'group' : 'rect', {
          id: `n${i}`,
          parentId: i === 0 ? undefined : `n${Math.floor((i - 1) / 2)}`,
        }),
      );
    }
    const expanded = expandWithDescendants(layers, ['n0']);
    expect(expanded.length).toBe(80);
  });

  it('flattenLayerTree of 100 and 1000 mixed layers stays under budget', () => {
    const makeTreeLayers = (n: number) =>
      Array.from({ length: n }, (_, i) =>
        createLayer(i % 7 === 0 ? 'group' : i % 11 === 0 ? 'text' : 'rect', {
          id: `n${i}`,
          parentId: i > 0 && i % 7 !== 0 ? `n${Math.floor(i / 7) * 7}` : undefined,
        }),
      );
    const run = (n: number) => {
      const layers = makeTreeLayers(n);
      const tree = buildLayerTree(layers);
      const expanded = new Set(layers.filter((l) => l.type === 'group').map((l) => l.id));
      const t0 = performance.now();
      const rows = flattenLayerTree(tree, expanded);
      const window = layerVirtualWindow({ rowCount: rows.length, scrollTop: 2400, listHeight: 400 });
      const elapsed = performance.now() - t0;
      return { rows, window, elapsed };
    };
    const small = run(100);
    const large = run(1000);
    expect(small.rows.length).toBeGreaterThan(20);
    expect(large.rows.length).toBeGreaterThan(200);
    expect(large.window.end).toBeGreaterThan(large.window.start);
    expect(small.elapsed).toBeLessThan(40);
    expect(large.elapsed).toBeLessThan(120);
  });

  it('60 move frames on 200 layers stay under budget', () => {
    const layers = makeLayers(200);
    const t0 = performance.now();
    let current = layers;
    for (let i = 0; i < 60; i++) {
      current = moveSelection(layers, ['l5'], i * 0.1, 0);
    }
    const elapsed = performance.now() - t0;
    expect(current).not.toBe(layers);
    expect(elapsed).toBeLessThan(250);
  });

  it('patchLayersById only rewrites updated slots', () => {
    const layers = makeLayers(40);
    const updated = { ...layers[3]!, name: 'patched' };
    const next = patchLayersById(layers, new Map([['l3', updated]]));
    expect(next[3]).toBe(updated);
    expect(next[0]).toBe(layers[0]);
    expect(replaceLayerById(layers, updated)[3]).toBe(updated);
  });

  it('cloneDocumentBaseline shares inactive page layer refs', () => {
    const page0 = createLayer('rect', { id: 'a', pageIndex: 0 });
    const page1 = createLayer('rect', { id: 'b', pageIndex: 1 });
    const doc: CanvasDocument = {
      id: 'd1',
      name: 'Doc',
      version: 2,
      updatedAt: new Date().toISOString(),
      page: { widthMm: 210, heightMm: 297 },
      layers: [page0, page1],
      fields: [],
    };
    const baseline = cloneDocumentBaseline(doc, 0);
    expect(baseline.layers[0]).not.toBe(page0);
    expect(baseline.layers[1]).toBe(page1);
    const full = cloneDocument(doc);
    expect(full.layers[0]).not.toBe(page0);
    expect(full.layers[1]).not.toBe(page1);
  });

  it('cloneDocument deep-copies nested meta arrays and path points', () => {
    const layer = createLayer('grid', {
      id: 'g1',
      meta: {
        cols: 2,
        rows: 2,
        colTracks: [1, 2],
        rowTracks: [3, 4],
        rules: [{ whenImages: 4, cols: 2, rows: 2 }],
        path: {
          closed: false,
          points: [{ x: 0, y: 0, hin: { x: 1, y: 1 }, hout: null }],
        },
      },
    });
    const doc: CanvasDocument = {
      id: 'd1',
      name: 'Doc',
      version: 2,
      updatedAt: new Date().toISOString(),
      page: { widthMm: 210, heightMm: 297 },
      layers: [layer],
      fields: [],
    };
    const cloned = cloneDocument(doc);
    expect(cloned.layers[0].meta?.colTracks).toEqual([1, 2]);
    expect(cloned.layers[0].meta?.colTracks).not.toBe(layer.meta?.colTracks);
    expect(cloned.layers[0].meta?.rowTracks).not.toBe(layer.meta?.rowTracks);
    expect(cloned.layers[0].meta?.rules).not.toBe(layer.meta?.rules);
    expect(cloned.layers[0].meta?.rules?.[0]).not.toBe(layer.meta?.rules?.[0]);
    expect(cloned.layers[0].meta?.path?.points).not.toBe(layer.meta?.path?.points);
    expect(cloned.layers[0].meta?.path?.points[0]).not.toBe(layer.meta?.path?.points[0]);
    expect(cloned.layers[0].meta?.path?.points[0].hin).not.toBe(layer.meta?.path?.points[0].hin);
    cloned.layers[0].meta!.colTracks![0] = 99;
    expect(layer.meta?.colTracks?.[0]).toBe(1);
  });

  it('rotateSelection preserves untouched identity', () => {
    const layers = makeLayers(100);
    const next = rotateSelection(layers, ['l1'], 15);
    let same = 0;
    for (let i = 0; i < layers.length; i++) {
      if (next[i] === layers[i]) same += 1;
    }
    expect(same).toBe(99);
  });

  it('setActivePageLayers preserves untouched refs across a 200-layer page', () => {
    const pageLayers = makeLayers(200).map((l) => ({ ...l, pageIndex: 0 }));
    const doc: CanvasDocument = {
      id: 'd1',
      name: 'Doc',
      version: 2,
      updatedAt: new Date().toISOString(),
      page: { widthMm: 210, heightMm: 297 },
      layers: pageLayers,
      fields: [],
    };
    const moved = moveSelection(pageLayers, ['l0'], 5, 0);
    const t0 = performance.now();
    const next = setActivePageLayers(doc, 0, moved);
    const elapsed = performance.now() - t0;
    let same = 0;
    for (let i = 0; i < pageLayers.length; i++) {
      if (next.layers[i] === pageLayers[i]) same += 1;
    }
    expect(same).toBe(199);
    expect(next.layers[0]).not.toBe(pageLayers[0]);
    expect(elapsed).toBeLessThan(50);
  });

  it('setActivePageLayers no-op is referentially equal (gesture-start baseline)', () => {
    const layers = makeLayers(80).map((l) => ({ ...l, pageIndex: 0 }));
    const doc: CanvasDocument = {
      id: 'd1',
      name: 'Doc',
      version: 2,
      updatedAt: new Date().toISOString(),
      page: { widthMm: 210, heightMm: 297 },
      layers,
      fields: [],
    };
    expect(setActivePageLayers(doc, 0, layers)).toBe(doc);
  });

  it('layerDomTransform matches translate + rotate composition', async () => {
    const { layerDomTransform, applyLayerDomTransforms } = await import('../ops/imperativeLayerDom');
    const layer = createLayer('rect', {
      id: 'r1',
      cssVars: {
        '--translate-x': '10mm',
        '--translate-y': '20mm',
        '--width': '8mm',
        '--height': '8mm',
        '--rotate': '15deg',
      },
    });
    expect(layerDomTransform(layer)).toContain('translate(');
    expect(layerDomTransform(layer)).toContain('rotate(15deg)');

    const root = document.createElement('div');
    const node = document.createElement('div');
    node.dataset.layerId = 'r1';
    root.appendChild(node);
    applyLayerDomTransforms(root, [layer], ['r1']);
    expect(node.style.transform).toContain('translate(');
    expect(node.style.willChange).toBe('transform');
  });

  it('applyLayerDomGeometry writes size + transform; clear drops will-change', async () => {
    const { applyLayerDomGeometry, clearLayerDomGestureStyles } = await import('../ops/imperativeLayerDom');
    const layer = createLayer('rect', {
      id: 'r2',
      cssVars: {
        '--translate-x': '10mm',
        '--translate-y': '20mm',
        '--width': '25mm',
        '--height': '12mm',
      },
    });
    const root = document.createElement('div');
    const node = document.createElement('div');
    node.dataset.layerId = 'r2';
    root.appendChild(node);
    applyLayerDomGeometry(root, [layer], ['r2']);
    expect(node.style.transform).toContain('translate(');
    expect(node.style.width).toBe(`${Math.round((25 * 96) / 25.4)}px`);
    expect(node.style.height).toBe(`${Math.round((12 * 96) / 25.4)}px`);
    expect(node.style.willChange).toBe('transform');
    clearLayerDomGestureStyles(root, [layer], ['r2']);
    expect(node.style.willChange).toBe('');
  });

  it('applyLayerDomGeometry guards width and height writes avoiding redundant assignments', async () => {
    const { applyLayerDomGeometry, applyLayerDomTransforms } = await import('../ops/imperativeLayerDom');
    const layer = createLayer('rect', {
      id: 'r3',
      cssVars: {
        '--translate-x': '5mm',
        '--translate-y': '5mm',
        '--width': '20mm',
        '--height': '10mm',
      },
    });
    const root = document.createElement('div');
    const node = document.createElement('div');
    node.dataset.layerId = 'r3';
    root.appendChild(node);

    applyLayerDomGeometry(root, [layer], ['r3']);
    const initialWidth = node.style.width;
    const initialHeight = node.style.height;

    let widthWrites = 0;
    let heightWrites = 0;
    Object.defineProperty(node.style, 'width', {
      get: () => initialWidth,
      set: () => {
        widthWrites++;
      },
      configurable: true,
    });
    Object.defineProperty(node.style, 'height', {
      get: () => initialHeight,
      set: () => {
        heightWrites++;
      },
      configurable: true,
    });

    applyLayerDomGeometry(root, [layer], ['r3']);
    expect(widthWrites).toBe(0);
    expect(heightWrites).toBe(0);

    applyLayerDomTransforms(root, [layer], ['r3']);
    expect(widthWrites).toBe(0);
    expect(heightWrites).toBe(0);
  });

  it('layerNeedsDocumentLayers is false for plain rects (memo ignores displayLayers identity)', async () => {
    const { documentLayersRelevantEqual, layerNeedsDocumentLayers } = await import('../editor/LayerNode');
    const rect = createLayer('rect', { id: 'r1' });
    const mask = createLayer('rect', { id: 'm1' });
    const masked = createLayer('rect', { id: 'r2', meta: { maskLayerId: 'm1' } });
    const bool = createLayer('boolean', { id: 'b1', meta: { ops: [{ op: 'union', layerId: 'm1' }] } });
    expect(layerNeedsDocumentLayers(rect)).toBe(false);
    expect(layerNeedsDocumentLayers(masked)).toBe(true);
    expect(layerNeedsDocumentLayers(bool)).toBe(true);
    const layersA = [mask, masked];
    const layersB = [mask, { ...masked, name: 'renamed-unrelated' }];
    expect(documentLayersRelevantEqual(masked, layersA, layersB)).toBe(true);
    const layersC = [{ ...mask, name: 'mask-moved' }, masked];
    expect(documentLayersRelevantEqual(masked, layersA, layersC)).toBe(false);
  });

  it('ancestorIds with prebuilt Map stays linear for many matches', () => {
    const layers = [];
    for (let i = 0; i < 200; i++) {
      layers.push(
        createLayer(i % 10 === 0 ? 'group' : 'rect', {
          id: `n${i}`,
          parentId: i === 0 ? undefined : `n${Math.floor((i - 1) / 2)}`,
        }),
      );
    }
    const byId = new Map(layers.map((l) => [l.id, l]));
    const t0 = performance.now();
    for (let i = 100; i < 200; i++) {
      ancestorIds(byId, `n${i}`);
    }
    expect(performance.now() - t0).toBeLessThan(50);
  });

  it('layerBounds caches results by cssVars reference', async () => {
    const { layerBounds } = await import('../ops/layerBounds');
    const layer = createLayer('rect', {
      id: 'r1',
      cssVars: {
        '--translate-x': '15mm',
        '--translate-y': '25mm',
        '--width': '30mm',
        '--height': '40mm',
      },
    });
    const b1 = layerBounds(layer);
    const b2 = layerBounds(layer);
    expect(b1).toBe(b2);
    expect(b1.x).toBe(15);
    expect(b1.y).toBe(25);
    expect(b1.w).toBe(30);
    expect(b1.h).toBe(40);
  });

  it('selectionBounds single item fast-path matches multi-item logic', async () => {
    const { selectionBounds } = await import('../ops/selectionTransform');
    const layers = makeLayers(20);
    const single = selectionBounds(layers, ['l3']);
    expect(single).toEqual({
      x: 30,
      y: 0,
      w: 8,
      h: 8,
    });
  });

  it('buildSpatialIndex and compositionHiddenLayerIds cache per layers instance', async () => {
    const { buildSpatialIndex } = await import('../ops/spatialIndex');
    const { compositionHiddenLayerIds } = await import('../ops/booleanOps');
    const layers = makeLayers(50);
    const idx1 = buildSpatialIndex(layers);
    const idx2 = buildSpatialIndex(layers);
    expect(idx1).toBe(idx2);

    const hide1 = compositionHiddenLayerIds(layers);
    const hide2 = compositionHiddenLayerIds(layers);
    expect(hide1).toBe(hide2);
  });

  it('parseMm fast-path parses mm, px and invalid strings accurately', async () => {
    const { parseMm } = await import('../types');
    expect(parseMm('96px')).toBeCloseTo(25.4, 10);
    expect(parseMm(undefined, 5)).toBe(5);
    expect(parseMm('invalid', 12)).toBe(12);
  });
});
