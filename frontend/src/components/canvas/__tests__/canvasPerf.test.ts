import { describe, expect, it } from 'vitest';
import { createLayer } from '../constants';
import { cloneDocument, cloneDocumentBaseline } from '../ops/document';
import { ancestorIds, expandWithDescendants } from '../ops/layerTree';
import { setActivePageLayers } from '../ops/pages';
import { patchLayersById, replaceLayerById } from '../ops/patchLayers';
import { moveSelection, rotateSelection } from '../ops/selectionTransform';
import { buildSpatialIndex } from '../ops/spatialIndex';
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

  it('60 move frames on 200 layers stay under budget', () => {
    const layers = makeLayers(200);
    const t0 = performance.now();
    let current = layers;
    for (let i = 0; i < 60; i++) {
      current = moveSelection(layers, ['l5'], i * 0.1, 0);
    }
    const elapsed = performance.now() - t0;
    expect(current).not.toBe(layers);
    // Loose CI budget (~16ms/frame × 60 would be 960ms; we expect far less for pure ops).
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

  it('spatial hitTest returns top-most layer first', () => {
    const bottom = createLayer('rect', {
      id: 'bottom',
      cssVars: {
        '--translate-x': '10mm',
        '--translate-y': '10mm',
        '--width': '20mm',
        '--height': '20mm',
      },
    });
    const top = createLayer('rect', {
      id: 'top',
      cssVars: {
        '--translate-x': '12mm',
        '--translate-y': '12mm',
        '--width': '20mm',
        '--height': '20mm',
      },
    });
    const hits = buildSpatialIndex([bottom, top]).hitTest(15, 15);
    expect(hits[0]).toBe('top');
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
    // Same mask layer ref → masked node skips re-render despite array identity change.
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
});
