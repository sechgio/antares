import { describe, expect, it } from 'vitest';
import { syncLinkedStylesFromLayer } from '../syncLinkedStyles';
import { createLayer } from '../../constants';
import { createEmptyDocument, type CanvasDocument, type CanvasSharedStyle } from '../../types';

function makeDocWithStyles(styles: CanvasSharedStyle[]): CanvasDocument {
  return { ...createEmptyDocument('t'), styles };
}

describe('syncLinkedStylesFromLayer', () => {
  it('devuelve el doc intacto si no hay capa previa', () => {
    const doc = makeDocWithStyles([]);
    const next = createLayer('rect');
    expect(syncLinkedStylesFromLayer(doc, undefined, next)).toBe(doc);
  });

  it('no toca estilos si la capa no tiene styleIds', () => {
    const style: CanvasSharedStyle = {
      id: 's1', name: 'Color · base', kind: 'color', cssVars: { '--background-color': '#fff' },
    };
    const doc = makeDocWithStyles([style]);
    const layer = createLayer('rect');
    expect(syncLinkedStylesFromLayer(doc, layer, { ...layer })).toBe(doc);
  });

  it('actualiza el estilo de color cuando cambian sus vars', () => {
    const style: CanvasSharedStyle = {
      id: 'fill-1', name: 'Color · rect', kind: 'color', cssVars: { '--background-color': '#fff' },
    };
    const doc = makeDocWithStyles([style]);
    const prev = createLayer('rect', {
      fillStyleId: 'fill-1',
      cssVars: { '--background-color': '#fff', '--width': '10mm' },
    });
    const next = { ...prev, cssVars: { ...prev.cssVars, '--background-color': '#f00' } };
    const out = syncLinkedStylesFromLayer(doc, prev, next);
    expect(out).not.toBe(doc);
    expect(out.styles!.find((s) => s.id === 'fill-1')!.cssVars['--background-color']).toBe('#f00');
  });

  it('no propaga vars que no pertenecen al kind del estilo', () => {
    const style: CanvasSharedStyle = {
      id: 'fill-1', name: 'c', kind: 'color', cssVars: { '--background-color': '#fff' },
    };
    const doc = makeDocWithStyles([style]);
    const prev = createLayer('rect', {
      fillStyleId: 'fill-1',
      cssVars: { '--background-color': '#fff' },
    });
    const next = {
      ...prev,
      cssVars: { ...prev.cssVars, '--background-color': '#f00', '--font-size': '99pt' },
    };
    const out = syncLinkedStylesFromLayer(doc, prev, next);
    const updated = out.styles!.find((s) => s.id === 'fill-1')!;
    expect(updated.cssVars['--font-size']).toBeUndefined();
    expect(updated.cssVars['--background-color']).toBe('#f00');
  });

  it('devuelve el mismo doc si las vars del estilo no cambiaron', () => {
    const style: CanvasSharedStyle = {
      id: 'txt-1', name: 't', kind: 'text', cssVars: { '--color': '#111' },
    };
    const doc = makeDocWithStyles([style]);
    const prev = createLayer('text', {
      textStyleId: 'txt-1',
      cssVars: { '--color': '#111', '--width': '10mm' },
    });
    const next = { ...prev, cssVars: { ...prev.cssVars, '--width': '20mm' } };
    expect(syncLinkedStylesFromLayer(doc, prev, next)).toBe(doc);
  });

  it('actualiza varios kinds en una sola pasada', () => {
    const styles: CanvasSharedStyle[] = [
      { id: 'f1', name: 'f', kind: 'color', cssVars: { '--background-color': '#fff' } },
      { id: 't1', name: 't', kind: 'text', cssVars: { '--color': '#111' } },
    ];
    const doc = makeDocWithStyles(styles);
    const prev = createLayer('rect', {
      fillStyleId: 'f1',
      textStyleId: 't1',
      cssVars: { '--background-color': '#fff', '--color': '#111' },
    });
    const next = {
      ...prev,
      cssVars: { ...prev.cssVars, '--background-color': '#00f', '--color': '#eee' },
    };
    const out = syncLinkedStylesFromLayer(doc, prev, next);
    expect(out.styles!.find((s) => s.id === 'f1')!.cssVars['--background-color']).toBe('#00f');
    expect(out.styles!.find((s) => s.id === 't1')!.cssVars['--color']).toBe('#eee');
  });

  it('ignora styleIds que no existen en el documento', () => {
    const doc = makeDocWithStyles([]);
    const prev = createLayer('rect', {
      fillStyleId: 'fantasma',
      cssVars: { '--background-color': '#fff' },
    });
    const next = { ...prev, cssVars: { ...prev.cssVars, '--background-color': '#f00' } };
    const out = syncLinkedStylesFromLayer(doc, prev, next);
    expect(out.styles).toEqual([]);
  });

  it('una var eliminada de la capa no la quita del estilo (merge aditivo)', () => {
    const style: CanvasSharedStyle = {
      id: 'e1', name: 'e', kind: 'effect',
      cssVars: { '--box-shadow': '0 1mm 2mm #000' },
    };
    const doc = makeDocWithStyles([style]);
    const prev = createLayer('rect', {
      effectStyleId: 'e1',
      cssVars: { '--box-shadow': '0 1mm 2mm #000' },
    });
    const nextVars = { ...prev.cssVars };
    delete nextVars['--box-shadow'];
    const next = { ...prev, cssVars: nextVars };
    const out = syncLinkedStylesFromLayer(doc, prev, next);
    expect(out.styles!.find((s) => s.id === 'e1')!.cssVars['--box-shadow']).toBe('0 1mm 2mm #000');
  });
});
