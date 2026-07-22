import { describe, expect, it } from 'vitest';
import { createLayer } from '../constants';
import { bringForward, deleteLayers, nudgeLayers, reorderAmongSiblings, setLayersOpacity } from '../ops/layerOps';
import {
  buildLayerTree,
  expandWithDescendants,
  flattenLayerTree,
} from '../ops/layerTree';
import { moveSelection } from '../ops/selectionTransform';
import { parseMm } from '../types';

describe('layerTree', () => {
  it('nests children under group/grid by parentId', () => {
    const group = createLayer('group', { id: 'g1', name: 'Grupo' });
    const a = createLayer('text', { id: 'a', name: 'A', parentId: 'g1' });
    const b = createLayer('field', { id: 'b', name: 'B' });
    const tree = buildLayerTree([group, a, b]);
    expect(tree.map((n) => n.layer.id)).toEqual(['b', 'g1']);
    expect(tree.find((n) => n.layer.id === 'g1')!.children.map((c) => c.layer.id)).toEqual(['a']);
  });

  it('flatten respects collapsed parents', () => {
    const group = createLayer('group', { id: 'g1' });
    const a = createLayer('text', { id: 'a', parentId: 'g1' });
    const tree = buildLayerTree([group, a]);
    const collapsed = flattenLayerTree(tree, new Set());
    expect(collapsed.map((r) => r.layer.id)).toEqual(['g1']);
    const expanded = flattenLayerTree(tree, new Set(['g1']));
    expect(expanded.map((r) => `${r.layer.id}:${r.depth}`)).toEqual(['g1:0', 'a:1']);
  });

  it('expandWithDescendants includes group children', () => {
    const group = createLayer('group', { id: 'g1' });
    const a = createLayer('text', { id: 'a', parentId: 'g1' });
    expect(expandWithDescendants([group, a], ['g1']).sort()).toEqual(['a', 'g1']);
  });

  it('moveSelection moves group descendants', () => {
    const group = createLayer('group', {
      id: 'g1',
      cssVars: {
        ...createLayer('group').cssVars,
        '--translate-x': '10mm',
        '--translate-y': '10mm',
      },
    });
    const child = createLayer('text', {
      id: 'a',
      parentId: 'g1',
      cssVars: {
        ...createLayer('text').cssVars,
        '--translate-x': '12mm',
        '--translate-y': '14mm',
      },
    });
    const next = moveSelection([group, child], ['g1'], 5, 0);
    expect(parseMm(next.find((l) => l.id === 'g1')!.cssVars['--translate-x'])).toBe(15);
    expect(parseMm(next.find((l) => l.id === 'a')!.cssVars['--translate-x'])).toBe(17);
  });

  it('nudgeLayers moves group descendants', () => {
    const group = createLayer('group', {
      id: 'g1',
      cssVars: {
        ...createLayer('group').cssVars,
        '--translate-x': '10mm',
        '--translate-y': '10mm',
      },
    });
    const child = createLayer('text', {
      id: 'a',
      parentId: 'g1',
      cssVars: {
        ...createLayer('text').cssVars,
        '--translate-x': '12mm',
        '--translate-y': '14mm',
      },
    });
    const next = nudgeLayers([group, child], ['g1'], 0, 3);
    expect(parseMm(next.find((l) => l.id === 'g1')!.cssVars['--translate-y'])).toBe(13);
    expect(parseMm(next.find((l) => l.id === 'a')!.cssVars['--translate-y'])).toBe(17);
  });

  it('deleteLayers cascades to descendants', () => {
    const group = createLayer('group', { id: 'g1' });
    const a = createLayer('text', { id: 'a', parentId: 'g1' });
    const b = createLayer('field', { id: 'b' });
    const next = deleteLayers([group, a, b], ['g1']);
    expect(next.map((l) => l.id)).toEqual(['b']);
  });
});

describe('reorderAmongSiblings', () => {
  it('Capas-before puts dragged above target (later in document)', () => {
    const g = createLayer('group', { id: 'g' });
    const a = createLayer('text', { id: 'a', parentId: 'g' });
    const b = createLayer('text', { id: 'b', parentId: 'g' });
    // doc [g,a,b] → Capas siblings top-first [b,a]
    const next = reorderAmongSiblings([g, a, b], 'a', 'b', 'before');
    expect(next.filter((l) => l.parentId === 'g').map((l) => l.id)).toEqual(['b', 'a']);
  });

  it('rejects cross-parent reorder', () => {
    const g = createLayer('group', { id: 'g' });
    const a = createLayer('text', { id: 'a', parentId: 'g' });
    const b = createLayer('text', { id: 'b' });
    const layers = [g, a, b];
    expect(reorderAmongSiblings(layers, 'a', 'b', 'before')).toBe(layers);
  });

  it('bringForward moves one step toward front', () => {
    const a = createLayer('text', { id: 'a' });
    const b = createLayer('text', { id: 'b' });
    const next = bringForward([a, b], ['a']);
    expect(next.map((l) => l.id)).toEqual(['b', 'a']);
  });

  it('setLayersOpacity updates selected unlocked layers', () => {
    const a = createLayer('text', { id: 'a' });
    const b = createLayer('text', { id: 'b', locked: true });
    const next = setLayersOpacity([a, b], ['a', 'b'], 40);
    expect(next.find((l) => l.id === 'a')!.cssVars['--opacity']).toBe('40%');
    expect(next.find((l) => l.id === 'b')!.cssVars['--opacity']).toBeUndefined();
  });
});
