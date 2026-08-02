import { describe, expect, it } from 'vitest';
import { createLayer } from '../constants';
import {
  bringForward,
  deleteLayers,
  groupLayers,
  moveLayerInTree,
  nudgeLayers,
  reorderAmongSiblings,
  setLayersOpacity,
} from '../ops/layerOps';
import {
  buildLayerTree,
  expandWithDescendants,
  flattenLayerTree,
} from '../ops/layerTree';
import { setActivePageLayers } from '../ops/pages';
import { moveSelection } from '../ops/selectionTransform';
import { parseMm, type CanvasDocument } from '../types';

describe('layerTree', () => {
  it('nests children under group/grid by parentId', () => {
    const group = createLayer('group', { id: 'g1', name: 'Grupo' });
    const a = createLayer('text', { id: 'a', name: 'A', parentId: 'g1' });
    const b = createLayer('field', { id: 'b', name: 'B' });
    const tree = buildLayerTree([group, a, b]);
    expect(tree.map((n) => n.layer.id)).toEqual(['b', 'g1']);
    expect(tree.find((n) => n.layer.id === 'g1')!.children.map((c) => c.layer.id)).toEqual(['a']);
  });

  it('expands children under component containers', () => {
    const comp = {
      ...createLayer('group', { id: 'c1', name: 'Comp' }),
      type: 'component' as const,
      meta: { componentId: 'c1' },
    };
    const child = createLayer('text', { id: 't1', parentId: 'c1' });
    const tree = buildLayerTree([comp, child]);
    const node = tree.find((n) => n.layer.id === 'c1')!;
    expect(node.children.map((c) => c.layer.id)).toEqual(['t1']);
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
    expect(next.find((l) => l.id === 'a')!.cssVars['--opacity']).toBe('40');
    expect(next.find((l) => l.id === 'b')!.cssVars['--opacity']).toBeUndefined();
  });
});

describe('moveLayerInTree', () => {
  it('reparents root layer inside a group', () => {
    const g = createLayer('group', { id: 'g' });
    const a = createLayer('text', { id: 'a', parentId: 'g' });
    const b = createLayer('text', { id: 'b' });
    const next = moveLayerInTree([g, a, b], 'b', 'g', 'inside');
    expect(next.find((l) => l.id === 'b')!.parentId).toBe('g');
    expect(next.filter((l) => l.parentId === 'g').map((l) => l.id)).toEqual(['a', 'b']);
  });

  it('moves child out of group to root via before on root sibling', () => {
    const g = createLayer('group', { id: 'g' });
    const a = createLayer('text', { id: 'a', parentId: 'g' });
    const b = createLayer('text', { id: 'b' });
    // Capas roots top-first [b, g]; drop a before b → a becomes root, above b
    const next = moveLayerInTree([g, a, b], 'a', 'b', 'before');
    expect(next.find((l) => l.id === 'a')!.parentId).toBeUndefined();
    const roots = next.filter((l) => !l.parentId && l.type !== 'frame');
    expect(roots.map((l) => l.id)).toEqual(['g', 'b', 'a']);
  });

  it('cross-parent before places under target parent', () => {
    const g = createLayer('group', { id: 'g' });
    const a = createLayer('text', { id: 'a', parentId: 'g' });
    const b = createLayer('text', { id: 'b' });
    const next = moveLayerInTree([g, a, b], 'b', 'a', 'before');
    expect(next.find((l) => l.id === 'b')!.parentId).toBe('g');
    expect(next.filter((l) => l.parentId === 'g').map((l) => l.id)).toEqual(['a', 'b']);
  });

  it('rejects nesting a group inside its descendant', () => {
    const outer = createLayer('group', { id: 'outer' });
    const inner = createLayer('group', { id: 'inner', parentId: 'outer' });
    const child = createLayer('text', { id: 'c', parentId: 'inner' });
    const layers = [outer, inner, child];
    expect(moveLayerInTree(layers, 'outer', 'inner', 'inside')).toBe(layers);
    expect(moveLayerInTree(layers, 'outer', 'c', 'before')).toBe(layers);
  });

  it('sibling-only reorder matches Capas-before semantics', () => {
    const g = createLayer('group', { id: 'g' });
    const a = createLayer('text', { id: 'a', parentId: 'g' });
    const b = createLayer('text', { id: 'b', parentId: 'g' });
    const next = moveLayerInTree([g, a, b], 'a', 'b', 'before');
    expect(next.filter((l) => l.parentId === 'g').map((l) => l.id)).toEqual(['b', 'a']);
  });

  it('rejects inside on non-container', () => {
    const a = createLayer('text', { id: 'a' });
    const b = createLayer('text', { id: 'b' });
    const layers = [a, b];
    expect(moveLayerInTree(layers, 'a', 'b', 'inside')).toBe(layers);
  });
});

describe('groupLayers', () => {
  it('assigns pageIndex from children so Capas keeps the group on that page', () => {
    const a = createLayer('rect', { id: 'a' });
    a.pageIndex = 1;
    a.cssVars = { ...a.cssVars, '--translate-x': '10mm', '--translate-y': '10mm', '--width': '20mm', '--height': '20mm' };
    const b = createLayer('text', { id: 'b' });
    b.pageIndex = 1;
    b.cssVars = { ...b.cssVars, '--translate-x': '40mm', '--translate-y': '10mm', '--width': '30mm', '--height': '10mm' };
    const { layers, groupId } = groupLayers([a, b], ['a', 'b']);
    const group = layers.find((l) => l.id === groupId)!;
    expect(group.pageIndex).toBe(1);
    expect(layers.filter((l) => l.parentId === groupId).map((l) => l.id).sort()).toEqual(['a', 'b']);
  });

  it('rejects grouping when children span multiple pages', () => {
    const a = createLayer('rect', { id: 'a', pageIndex: 0 });
    a.cssVars = { ...a.cssVars, '--translate-x': '10mm', '--translate-y': '10mm', '--width': '20mm', '--height': '20mm' };
    const b = createLayer('text', { id: 'b', pageIndex: 1 });
    b.cssVars = { ...b.cssVars, '--translate-x': '40mm', '--translate-y': '10mm', '--width': '30mm', '--height': '10mm' };
    const input = [a, b];
    const { layers, groupId } = groupLayers(input, ['a', 'b']);
    expect(groupId).toBe('');
    expect(layers).toBe(input);
  });
});

describe('setActivePageLayers', () => {
  function makeDoc(layers: ReturnType<typeof createLayer>[]): CanvasDocument {
    return {
      id: 'd1',
      name: 'Test',
      version: 2,
      updatedAt: new Date().toISOString(),
      page: { widthMm: 210, heightMm: 297 },
      layers,
      fields: [],
    };
  }

  it('preserves document array order when replacing active page layers', () => {
    const p0a = createLayer('rect', { id: 'p0a', pageIndex: 0 });
    const p1b = createLayer('text', { id: 'p1b', pageIndex: 1 });
    const p0c = createLayer('rect', { id: 'p0c', pageIndex: 0 });
    const doc = makeDoc([p0a, p1b, p0c]);

    // Update only p0a on page 0; p0c is dropped (not in incoming), p1b stays.
    const updated = setActivePageLayers(doc, 0, [
      { ...p0a, name: 'Renamed' },
    ]);
    expect(updated.layers.map((l) => l.id)).toEqual(['p0a', 'p1b']);
    expect(updated.layers[0].name).toBe('Renamed');
    expect(updated.layers[1]).toBe(p1b);
  });

  it('appends new layers at the end of the active page block', () => {
    const p0a = createLayer('rect', { id: 'p0a', pageIndex: 0 });
    const p1b = createLayer('text', { id: 'p1b', pageIndex: 1 });
    const doc = makeDoc([p0a, p1b]);
    const fresh = createLayer('rect', { id: 'fresh', pageIndex: 0 });

    const updated = setActivePageLayers(doc, 0, [p0a, fresh]);
    expect(updated.layers.map((l) => l.id)).toEqual(['p0a', 'fresh', 'p1b']);
  });

  it('preserves layer object identity when pageIndex already matches', () => {
    const p0a = createLayer('rect', { id: 'p0a', pageIndex: 0 });
    const p0b = createLayer('rect', { id: 'p0b', pageIndex: 0 });
    const p1 = createLayer('text', { id: 'p1', pageIndex: 1 });
    const doc = makeDoc([p0a, p1, p0b]);
    const moved = { ...p0a, cssVars: { ...p0a.cssVars, '--translate-x': '30mm' } };

    const updated = setActivePageLayers(doc, 0, [moved, p0b]);
    expect(updated.layers[0]).toBe(moved);
    expect(updated.layers[1]).toBe(p1);
    expect(updated.layers[2]).toBe(p0b);
    expect(updated.layers[0]).not.toBe(p0a);
  });

  it('returns the same document ref when active page layers are unchanged', () => {
    const p0a = createLayer('rect', { id: 'p0a', pageIndex: 0 });
    const p1 = createLayer('text', { id: 'p1', pageIndex: 1 });
    const doc = makeDoc([p0a, p1]);
    expect(setActivePageLayers(doc, 0, [p0a])).toBe(doc);
  });
});
