import { describe, expect, it } from 'vitest';
import { createLayer } from '../../constants';
import { createEmptyDocument, mm } from '../../types';
import {
  applyInstanceOverrides,
  createComponentFromLayer,
  instantiateComponent,
  syncComponentToInstances,
} from '../components';
import {
  canonicalVariantKey,
  parseVariantKey,
  prepareVariantIndex,
  resolveVariantFromBinding,
  resolveVariantPatch,
} from '../variants';

describe('components', () => {
  describe('multidimensional variants & dynamic data-binding', () => {
    it('caches the prepared variant catalog by object identity', () => {
      const variants = {
        'Size=Large, Status=Active': { '--width': mm(120) },
        'Size=Small, Status=Active': { '--width': mm(40) },
      };

      const first = prepareVariantIndex(variants);
      expect(prepareVariantIndex(variants)).toBe(first);
      expect(first.entries).toHaveLength(2);
      expect(prepareVariantIndex({ ...variants })).not.toBe(first);
    });

    it('canonicalVariantKey normalizes whitespace, case, and sorts property keys', () => {
      const key = canonicalVariantKey({
        Status: 'Active',
        Size: 'Large',
        Theme: 'Dark',
      });
      expect(key).toBe('size=large, status=active, theme=dark');

      const messy = canonicalVariantKey({
        '  Color ': '  Blue  ',
        'Type': 'Primary',
        '': 'ignored',
      });
      expect(messy).toBe('color=blue, type=primary');
    });

    it('canonicalVariantKey is deterministic for case-colliding keys', () => {
      const a = canonicalVariantKey({ Color: 'x', color: 'y' });
      const b = canonicalVariantKey({ color: 'y', Color: 'x' });
      expect(a).toBe(b);
    });

    it('parseVariantKey extracts key-value pairs from comma or semicolon strings', () => {
      const parsed = parseVariantKey('Status=Aprobado, Size=Compacto; Theme=Dark');
      expect(parsed).toEqual({
        Status: 'Aprobado',
        Size: 'Compacto',
        Theme: 'Dark',
      });

      const booleanFlag = parseVariantKey('Disabled, Hover');
      expect(booleanFlag).toEqual({
        Disabled: 'true',
        Hover: 'true',
      });
    });

    it('resolves multidimensional variant regardless of property order', () => {
      const master = createComponentFromLayer(
        createLayer('rect', {
          id: 'card-master',
          cssVars: {
            ...createLayer('rect').cssVars,
            '--width': mm(50),
            '--background-color': '#CCCCCC',
          },
          meta: {
            variants: {
              'Size=Large, Status=Active': {
                '--width': mm(120),
                '--background-color': '#00AA00',
              },
              'Size=Small, Status=Active': {
                '--width': mm(40),
                '--background-color': '#00AA00',
              },
              'Size=Large, Status=Draft': {
                '--width': mm(120),
                '--background-color': '#FFAA00',
              },
            },
          },
        }),
        createEmptyDocument(),
      );

      // Query with reversed property order
      const res = resolveVariantPatch(master, undefined, {
        Status: 'Active',
        Size: 'Large',
      });

      expect(res.matchedKey).toBe('Size=Large, Status=Active');
      expect(res.patch['--width']).toBe(mm(120));
      expect(res.patch['--background-color']).toBe('#00AA00');
    });

    it('resolves compound string key formatted with = notation', () => {
      const master = createComponentFromLayer(
        createLayer('rect', {
          id: 'btn-master',
          meta: {
            variants: {
              'Mode=Dark, Variant=Outline': {
                '--border-color': '#FFFFFF',
                '--background-color': '#1E293B',
              },
            },
          },
        }),
        createEmptyDocument(),
      );

      const res = resolveVariantPatch(master, 'Variant=Outline, Mode=Dark');
      expect(res.matchedKey).toBe('Mode=Dark, Variant=Outline');
      expect(res.patch['--border-color']).toBe('#FFFFFF');
    });

    it('performs case-insensitive canonical matching for variant properties', () => {
      const master = createComponentFromLayer(
        createLayer('rect', {
          id: 'badge-master',
          meta: {
            variants: {
              'Status=Approved, Type=Solid': {
                '--background-color': '#10B981',
              },
            },
          },
        }),
        createEmptyDocument(),
      );

      const res = resolveVariantPatch(master, undefined, {
        status: 'approved',
        type: 'solid',
      });
      expect(res.matchedKey).toBe('Status=Approved, Type=Solid');
      expect(res.patch['--background-color']).toBe('#10B981');
    });

    it('applies best-match scoring when exact compound variant combination does not exist', () => {
      const master = createComponentFromLayer(
        createLayer('rect', {
          id: 'tag-master',
          meta: {
            variants: {
              'Role=Admin, Level=High': { '--background-color': '#DC2626' },
              'Role=User, Level=Low': { '--background-color': '#3B82F6' },
            },
          },
        }),
        createEmptyDocument(),
      );

      // Query has Role=Admin, Level=Low (mixed).
      // Both match 1 property (score = 2).
      const res = resolveVariantPatch(master, undefined, {
        Role: 'Admin',
        Level: 'Medium',
      });
      // Admin matches exactly (score 2), Medium doesn't match Level=High or Level=Low (score 0.5 for key match)
      expect(res.matchedKey).toBe('Role=Admin, Level=High');
      expect(res.patch['--background-color']).toBe('#DC2626');
    });

    it('resolves dynamic data-binding with simple fieldKey and mapping', () => {
      const meta = {
        variantBinding: {
          fieldKey: 'estado_tramite',
          mapping: {
            '1': 'Aprobado',
            '0': 'Rechazado',
          },
          fallbackVariant: 'Pendiente',
        },
      };

      const res1 = resolveVariantFromBinding(meta, { estado_tramite: '1' });
      expect(res1.boundVariant).toBe('Aprobado');

      const res0 = resolveVariantFromBinding(meta, { estado_tramite: '0' });
      expect(res0.boundVariant).toBe('Rechazado');

      const resFallback = resolveVariantFromBinding(meta, { estado_tramite: '' });
      expect(resFallback.boundVariant).toBe('Pendiente');
    });

    it('resolves dynamic data-binding with multidimensional propBindings', () => {
      const meta = {
        variantBinding: {
          propBindings: {
            Status: {
              fieldKey: 'cod_estado',
              mapping: { A: 'Active', I: 'Inactive' },
            },
            Size: {
              fieldKey: 'tamano',
              fallback: 'Normal',
            },
          },
        },
      };

      const res = resolveVariantFromBinding(meta, {
        cod_estado: 'A',
        tamano: 'Large',
      });

      expect(res.boundProps).toEqual({
        Status: 'Active',
        Size: 'Large',
      });

      const resFallback = resolveVariantFromBinding(meta, {
        cod_estado: 'I',
      });

      expect(resFallback.boundProps).toEqual({
        Status: 'Inactive',
        Size: 'Normal',
      });
    });

    it('applyInstanceOverrides applies dynamic data variant styling while user override wins', () => {
      const master = createComponentFromLayer(
        createLayer('rect', {
          id: 'status-badge',
          cssVars: {
            ...createLayer('rect').cssVars,
            '--background-color': '#888888',
            '--color': '#000000',
            '--width': mm(40),
          },
          meta: {
            variants: {
              Aprobado: {
                '--background-color': '#22C55E',
                '--color': '#FFFFFF',
                '--width': mm(60),
              },
              Rechazado: {
                '--background-color': '#EF4444',
                '--color': '#FFFFFF',
                '--width': mm(50),
              },
            },
          },
        }),
        createEmptyDocument(),
      );

      const instance = {
        ...master,
        id: 'inst-1',
        meta: {
          instanceOf: 'status-badge',
          variantBinding: {
            fieldKey: 'estado',
            mapping: { AP: 'Aprobado', RE: 'Rechazado' },
          },
          // User manually customized text color override
          overrideVars: {
            '--color': '#FFFF00',
          },
        },
      };

      // 1. With row data AP (Aprobado)
      const cssAP = applyInstanceOverrides(instance, master, { estado: 'AP' });
      expect(cssAP['--background-color']).toBe('#22C55E'); // From variant
      expect(cssAP['--width']).toBe(mm(60)); // From variant
      expect(cssAP['--color']).toBe('#FFFF00'); // User override wins!

      // 2. With row data RE (Rechazado)
      const cssRE = applyInstanceOverrides(instance, master, { estado: 'RE' });
      expect(cssRE['--background-color']).toBe('#EF4444'); // From variant
      expect(cssRE['--width']).toBe(mm(50)); // From variant
      expect(cssRE['--color']).toBe('#FFFF00'); // User override still wins!
    });

    it('instantiateComponent accepts variantProps options and seeds initial state', () => {
      const master = createComponentFromLayer(
        createLayer('rect', {
          id: 'm-comp',
          cssVars: {
            ...createLayer('rect').cssVars,
            '--background-color': '#FFFFFF',
          },
          meta: {
            variants: {
              'Size=Mini, Status=Online': {
                '--background-color': '#00FF00',
                '--width': mm(25),
              },
            },
          },
        }),
        createEmptyDocument(),
      );

      const { instance } = instantiateComponent(
        master,
        createEmptyDocument(),
        undefined,
        { variantProps: { Status: 'Online', Size: 'Mini' } },
      );

      expect(instance.meta?.variantProps).toEqual({
        Status: 'Online',
        Size: 'Mini',
      });
      expect(instance.cssVars['--background-color']).toBe('#00FF00');
      expect(instance.cssVars['--width']).toBe(mm(25));
    });

    it('syncComponentToInstances updates master style while preserving dynamic data variants', () => {
      let doc = createEmptyDocument();
      const master = createComponentFromLayer(
        createLayer('rect', {
          id: 'm-sync',
          cssVars: {
            ...createLayer('rect').cssVars,
            '--border-width': mm(1),
          },
          meta: {
            variants: {
              V1: { '--background-color': '#112233' },
            },
          },
        }),
        doc,
      );

      const instance = {
        ...master,
        id: 'inst-sync',
        meta: {
          instanceOf: 'm-sync',
          variantBinding: {
            fieldKey: 'type',
          },
        },
      };
      doc = { ...doc, layers: [master, instance] };

      const rowData = { type: 'V1' };
      const updatedMaster = {
        ...master,
        cssVars: {
          ...master.cssVars,
          '--border-width': mm(3),
        },
      };

      const nextDoc = syncComponentToInstances(doc, 'm-sync', updatedMaster, rowData);
      const nextInst = nextDoc.layers.find((l) => l.id === 'inst-sync')!;

      expect(nextInst.cssVars['--border-width']).toBe(mm(3)); // Master base updated
      expect(nextInst.cssVars['--background-color']).toBe('#112233'); // Dynamic variant applied
    });
  });
});
