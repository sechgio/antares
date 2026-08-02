import { describe, expect, it } from 'vitest';
import { createLayer } from '../../constants';
import { createEmptyDocument, mm } from '../../types';
import {
  applyInstanceOverrides,
  createComponentFromLayer,
  instantiateComponent,
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

  it('instantiateComponent copies base cssVars and applies overrideVars', () => {
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

    const { instance } = instantiateComponent(master, doc, {
      '--translate-x': mm(50),
      '--background-color': '#FF0000',
    });

    expect(instance.meta?.instanceOf).toBe('m1');
    expect(instance.cssVars['--width']).toBe(mm(40));
    expect(instance.cssVars['--height']).toBe(mm(12));
    expect(instance.cssVars['--translate-x']).toBe(mm(50));
    expect(instance.cssVars['--background-color']).toBe('#FF0000');
    expect(instance.meta?.overrideVars?.['--translate-x']).toBe(mm(50));
    expect(instance.meta?.overrideVars?.['--background-color']).toBe('#FF0000');
  });

  it('instantiateComponent remaps children parentId', () => {
    const doc = createEmptyDocument();
    const master = createComponentFromLayer(
      createLayer('rect', { id: 'm1', name: 'Card' }),
      doc,
    );
    // createLayer can't make component containers with children via type alone —
    // attach a child under the master id.
    const child = createLayer('text', { id: 'child-1', parentId: 'm1', name: 'Label' });
    doc.layers.push(master, child);

    const { instance, childLayers } = instantiateComponent(master, doc);
    expect(instance.id).not.toBe('m1');
    expect(childLayers).toHaveLength(1);
    expect(childLayers[0]!.parentId).toBe(instance.id);
    expect(childLayers[0]!.id).not.toBe('child-1');
    expect(childLayers[0]!.name).toBe('Label');
  });

  it('syncComponentToInstances updates instances and respects overrideVars', () => {
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
    });
    const { instance: b } = instantiateComponent(master, doc, {
      '--background-color': '#00FF00',
    });
    doc = { ...doc, layers: [...doc.layers, master, a, b] };

    const nextMaster = {
      ...master,
      cssVars: {
        ...master.cssVars,
        '--background-color': '#0000FF',
        '--width': mm(80),
      },
    };
    doc = syncComponentToInstances(doc, 'm1', nextMaster);

    const instA = doc.layers.find((l) => l.id === a.id)!;
    const instB = doc.layers.find((l) => l.id === b.id)!;

    // Shared master props pushed.
    expect(instA.cssVars['--width']).toBe(mm(80));
    expect(instB.cssVars['--width']).toBe(mm(80));
    // A kept position override; received new fill from master.
    expect(instA.cssVars['--translate-x']).toBe(mm(100));
    expect(instA.cssVars['--background-color']).toBe('#0000FF');
    // B kept fill override; still got width from master.
    expect(instB.cssVars['--background-color']).toBe('#00FF00');
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

  it('variant changes resolved cssVars', () => {
    const master = createComponentFromLayer(
      createLayer('rect', {
        id: 'm1',
        cssVars: {
          ...createLayer('rect').cssVars,
          '--background-color': '#111111',
          '--color': '#FFFFFF',
        },
        meta: {
          variants: {
            primary: { '--background-color': '#3366FF' },
            danger: { '--background-color': '#CC0000' },
          },
        },
      }),
      createEmptyDocument(),
    );
    // Re-apply componentId after merge (createComponentFromLayer keeps meta).
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

    const primary = {
      ...masterWithVariants,
      id: 'i-primary',
      meta: { instanceOf: 'm1', variant: 'primary' },
    };
    const danger = {
      ...masterWithVariants,
      id: 'i-danger',
      meta: { instanceOf: 'm1', variant: 'danger' },
    };

    expect(applyInstanceOverrides(primary, masterWithVariants)['--background-color']).toBe('#3366FF');
    expect(applyInstanceOverrides(danger, masterWithVariants)['--background-color']).toBe('#CC0000');
    // Base text color still from master.
    expect(applyInstanceOverrides(primary, masterWithVariants)['--color']).toBe('#FFFFFF');
  });
});
