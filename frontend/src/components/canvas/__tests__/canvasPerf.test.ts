import { describe, expect, it } from 'vitest';
import { createLayer } from '../constants';
import { cloneDocument, cloneDocumentBaseline } from '../ops/document';
import { expandWithDescendants } from '../ops/layerTree';
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
});
