import { describe, expect, it } from 'vitest';
import { createLayer } from '../../constants';
import { createEmptyDocument, mm, parseMm } from '../../types';
import {
  applyInstanceOverrides,
  bakeInstanceOverrides,
  createComponentFromLayer,
  findComponentMaster,
  INSTANCE_OFFSET_MM,
  instantiateComponent,
  syncChangedMasters,
  syncComponentFromLayer,
  syncComponentToInstances,
} from '../components';

describe('components', () => {
  it('createComponentFromLayer marks type component and componentId', () => {
    const doc = createEmptyDocument();
    const layer = createLayer('rect', {
      id: 'master-1',
      name: 'Botón',
      cssVars: {
        ...createLayer('rect').cssVars,
        '--background-color': '#3366FF',
        '--width': mm(40),
        '--height': mm(12),
      },
    });
    const master = createComponentFromLayer(layer, doc);
    expect(master.type).toBe('component');
    expect(master.meta?.componentId).toBe('master-1');
    expect(master.id).toBe('master-1');
    expect(master.cssVars['--background-color']).toBe('#3366FF');
  });

  it('instantiateComponent copies base cssVars, seeds geo overrides, and offsets position', () => {
    const doc = createEmptyDocument();
    const master = createComponentFromLayer(
      createLayer('rect', {
        id: 'm1',
        cssVars: {
          ...createLayer('rect').cssVars,
          '--background-color': '#111111',
          '--width': mm(40),
          '--height': mm(12),
          '--translate-x': mm(10),
          '--translate-y': mm(10),
        },
      }),
      doc,
    );
    doc.layers.push(master);

    const { instance } = instantiateComponent(master, doc);

    expect(instance.meta?.instanceOf).toBe('m1');
    expect(instance.cssVars['--width']).toBe(mm(40));
    expect(instance.cssVars['--height']).toBe(mm(12));
    expect(parseMm(instance.cssVars['--translate-x'])).toBe(10 + INSTANCE_OFFSET_MM);
    expect(parseMm(instance.cssVars['--translate-y'])).toBe(10 + INSTANCE_OFFSET_MM);
    expect(instance.meta?.overrideVars?.['--translate-x']).toBe(instance.cssVars['--translate-x']);
    expect(instance.meta?.overrideVars?.['--translate-y']).toBe(instance.cssVars['--translate-y']);
  });

  it('instantiateComponent applies caller overrideVars (including explicit translate)', () => {
    const doc = createEmptyDocument();
    const master = createComponentFromLayer(
      createLayer('rect', {
        id: 'm1',
        cssVars: {
          ...createLayer('rect').cssVars,
          '--background-color': '#111111',
          '--width': mm(40),
          '--translate-x': mm(10),
          '--translate-y': mm(10),
        },
      }),
      doc,
    );
    doc.layers.push(master);

    const { instance } = instantiateComponent(master, doc, {
      '--translate-x': mm(50),
      '--background-color': '#FF0000',
    });

    expect(instance.cssVars['--translate-x']).toBe(mm(50));
    expect(instance.cssVars['--background-color']).toBe('#FF0000');
    expect(instance.meta?.overrideVars?.['--translate-x']).toBe(mm(50));
    expect(instance.meta?.overrideVars?.['--background-color']).toBe('#FF0000');
  });

  it('instantiateComponent remaps nested children parentId', () => {
    const doc = createEmptyDocument();
    const master = createComponentFromLayer(
      createLayer('rect', { id: 'm1', name: 'Card' }),
      doc,
    );
    const child = createLayer('text', { id: 'child-1', parentId: 'm1', name: 'Label' });
    const grand = createLayer('text', { id: 'grand-1', parentId: 'child-1', name: 'Nested' });
    doc.layers.push(master, child, grand);

    const { instance, childLayers } = instantiateComponent(master, doc);
    expect(instance.id).not.toBe('m1');
    expect(childLayers).toHaveLength(2);
    const instChild = childLayers.find((l) => l.name === 'Label')!;
    const instGrand = childLayers.find((l) => l.name === 'Nested')!;
    expect(instChild.parentId).toBe(instance.id);
    expect(instGrand.parentId).toBe(instChild.id);
  });

  it('syncComponentToInstances updates instances and respects overrideVars including geo', () => {
    let doc = createEmptyDocument();
    const master = createComponentFromLayer(
      createLayer('rect', {
        id: 'm1',
        cssVars: {
          ...createLayer('rect').cssVars,
          '--background-color': '#111111',
          '--width': mm(40),
          '--height': mm(12),
          '--translate-x': mm(0),
          '--translate-y': mm(0),
        },
      }),
      doc,
    );
    const { instance: a } = instantiateComponent(master, doc, {
      '--translate-x': mm(100),
      '--translate-y': mm(20),
    });
    const { instance: b } = instantiateComponent(master, doc, {
      '--background-color': '#00FF00',
      '--translate-x': mm(30),
      '--translate-y': mm(40),
    });
    doc = { ...doc, layers: [...doc.layers, master, a, b] };

    const nextMaster = {
      ...master,
      cssVars: {
        ...master.cssVars,
        '--background-color': '#0000FF',
        '--width': mm(80),
        '--translate-x': mm(999),
        '--translate-y': mm(999),
      },
    };
    doc = syncComponentToInstances(doc, 'm1', nextMaster);

    const instA = doc.layers.find((l) => l.id === a.id)!;
    const instB = doc.layers.find((l) => l.id === b.id)!;

    expect(instA.cssVars['--width']).toBe(mm(80));
    expect(instB.cssVars['--width']).toBe(mm(80));
    expect(instA.cssVars['--translate-x']).toBe(mm(100));
    expect(instA.cssVars['--translate-y']).toBe(mm(20));
    expect(instA.cssVars['--background-color']).toBe('#0000FF');
    expect(instB.cssVars['--background-color']).toBe('#00FF00');
  });

  it('bakeInstanceOverrides records panel/gesture cssVars into overrideVars', () => {
    const master = createComponentFromLayer(
      createLayer('rect', {
        id: 'm1',
        cssVars: {
          ...createLayer('rect').cssVars,
          '--background-color': '#111111',
          '--translate-x': mm(10),
          '--translate-y': mm(10),
        },
      }),
      createEmptyDocument(),
    );
    const { instance } = instantiateComponent(master, createEmptyDocument(), {
      '--translate-x': mm(10),
      '--translate-y': mm(10),
    });
    const dragged = {
      ...instance,
      cssVars: {
        ...instance.cssVars,
        '--translate-x': mm(77),
        '--background-color': '#ABCDEF',
      },
    };
    const baked = bakeInstanceOverrides(dragged, master);
    expect(baked.meta?.overrideVars?.['--translate-x']).toBe(mm(77));
    expect(baked.meta?.overrideVars?.['--background-color']).toBe('#ABCDEF');
    expect(applyInstanceOverrides(baked, master)['--translate-x']).toBe(mm(77));
    expect(applyInstanceOverrides(baked, master)['--background-color']).toBe('#ABCDEF');
  });

  it('syncComponentFromLayer is a no-op for instances and syncs masters', () => {
    let doc = createEmptyDocument();
    const master = createComponentFromLayer(
      createLayer('rect', {
        id: 'm1',
        cssVars: {
          ...createLayer('rect').cssVars,
          '--background-color': '#111111',
          '--translate-x': mm(0),
          '--translate-y': mm(0),
        },
      }),
      doc,
    );
    const { instance } = instantiateComponent(master, doc, {
      '--translate-x': mm(5),
      '--translate-y': mm(5),
    });
    doc = { ...doc, layers: [...doc.layers, master, instance] };

    const editedInstance = {
      ...instance,
      cssVars: { ...instance.cssVars, '--background-color': '#FF00FF' },
    };
    const afterInstanceEdit = syncComponentFromLayer(doc, instance, editedInstance);
    expect(afterInstanceEdit).toBe(doc);

    const nextMaster = {
      ...master,
      cssVars: { ...master.cssVars, '--background-color': '#0000FF' },
    };
    doc = { ...doc, layers: doc.layers.map((l) => (l.id === 'm1' ? nextMaster : l)) };
    doc = syncComponentFromLayer(doc, master, nextMaster);
    expect(doc.layers.find((l) => l.id === instance.id)!.cssVars['--background-color']).toBe(
      '#0000FF',
    );
  });

  it('syncChangedMasters propagates gesture edits from masters', () => {
    const master = createComponentFromLayer(
      createLayer('rect', {
        id: 'm1',
        cssVars: {
          ...createLayer('rect').cssVars,
          '--background-color': '#111111',
          '--width': mm(40),
          '--translate-x': mm(0),
          '--translate-y': mm(0),
        },
      }),
      createEmptyDocument(),
    );
    const { instance } = instantiateComponent(master, createEmptyDocument(), {
      '--translate-x': mm(20),
      '--translate-y': mm(20),
    });
    const baseline = {
      ...createEmptyDocument(),
      layers: [master, instance],
    };
    const movedMaster = {
      ...master,
      cssVars: {
        ...master.cssVars,
        '--background-color': '#222222',
        '--width': mm(90),
      },
    };
    let doc = { ...baseline, layers: [movedMaster, instance] };
    doc = syncChangedMasters(doc, baseline);
    const inst = doc.layers.find((l) => l.id === instance.id)!;
    expect(inst.cssVars['--background-color']).toBe('#222222');
    expect(inst.cssVars['--width']).toBe(mm(90));
    expect(inst.cssVars['--translate-x']).toBe(mm(20));
  });

  it('applyInstanceOverrides: override wins over master', () => {
    const master = createComponentFromLayer(
      createLayer('rect', {
        id: 'm1',
        cssVars: {
          ...createLayer('rect').cssVars,
          '--background-color': '#111111',
          '--width': mm(40),
        },
      }),
      createEmptyDocument(),
    );
    const instance = {
      ...master,
      id: 'i1',
      meta: {
        instanceOf: 'm1',
        overrideVars: { '--background-color': '#FF00AA', '--translate-x': mm(9) },
      },
      cssVars: { ...master.cssVars },
    };
    const resolved = applyInstanceOverrides(instance, master);
    expect(resolved['--background-color']).toBe('#FF00AA');
    expect(resolved['--translate-x']).toBe(mm(9));
    expect(resolved['--width']).toBe(mm(40));
  });

  it('variant changes resolved cssVars and survives sync', () => {
    const master = createComponentFromLayer(
      createLayer('rect', {
        id: 'm1',
        cssVars: {
          ...createLayer('rect').cssVars,
          '--background-color': '#111111',
          '--color': '#FFFFFF',
        },
      }),
      createEmptyDocument(),
    );
    const masterWithVariants = {
      ...master,
      meta: {
        ...master.meta,
        variants: {
          primary: { '--background-color': '#3366FF' },
          danger: { '--background-color': '#CC0000' },
        },
      },
    };

    const { instance } = instantiateComponent(masterWithVariants, createEmptyDocument(), undefined, 'primary');
    expect(applyInstanceOverrides(instance, masterWithVariants)['--background-color']).toBe('#3366FF');

    const danger = {
      ...instance,
      meta: { ...instance.meta, variant: 'danger' },
    };
    expect(applyInstanceOverrides(danger, masterWithVariants)['--background-color']).toBe('#CC0000');
    expect(applyInstanceOverrides(danger, masterWithVariants)['--color']).toBe('#FFFFFF');
  });

  it('findComponentMaster prefers componentId and ignores instances', () => {
    const master = createComponentFromLayer(
      createLayer('rect', { id: 'm1' }),
      createEmptyDocument(),
    );
    const { instance } = instantiateComponent(master, createEmptyDocument());
    const layers = [instance, master];
    expect(findComponentMaster(layers, 'm1')?.id).toBe('m1');
  });
});
