import { describe, expect, it } from 'vitest';
import { createLayer } from '../constants';
import {
  applyStyleToLayers,
  createAndLinkStyle,
  createStyleFromLayer,
  detachStyle,
  removeStyle,
  updateStyle,
} from '../ops/sharedStyles';
import { createEmptyDocument, normalizeDocument } from '../types';

describe('sharedStyles', () => {
  it('createStyleFromLayer picks only color keys', () => {
    const layer = createLayer('rect', {
      cssVars: {
        '--translate-x': '10mm',
        '--translate-y': '10mm',
        '--width': '40mm',
        '--height': '20mm',
        '--background-color': '#FF0000',
        '--fill-opacity': '80',
        '--fill-visible': '1',
        '--color': '#111111',
      },
    });
    const style = createStyleFromLayer(layer, 'color');
    expect(style.kind).toBe('color');
    expect(style.cssVars['--background-color']).toBe('#FF0000');
    expect(style.cssVars['--fill-opacity']).toBe('80');
    expect(style.cssVars['--translate-x']).toBeUndefined();
    expect(style.cssVars['--color']).toBeUndefined();
  });

  it('applyStyleToLayers writes cssVars and fillStyleId', () => {
    const a = createLayer('rect', {
      id: 'a',
      cssVars: {
        '--translate-x': '0mm',
        '--translate-y': '0mm',
        '--width': '10mm',
        '--height': '10mm',
        '--background-color': '#FFFFFF',
      },
    });
    const style = createStyleFromLayer(
      createLayer('rect', {
        cssVars: {
          ...createLayer('rect').cssVars,
          '--background-color': '#00AA00',
          '--fill-opacity': '100',
          '--fill-visible': '1',
        },
      }),
      'color',
    );
    const next = applyStyleToLayers([a], style, ['a']);
    expect(next[0]!.fillStyleId).toBe(style.id);
    expect(next[0]!.cssVars['--background-color']).toBe('#00AA00');
    expect(next[0]!.cssVars['--translate-x']).toBe('0mm');
  });

  it('updateStyle pushes to linked layers only', () => {
    let doc = createEmptyDocument();
    const a = createLayer('rect', {
      id: 'a',
      cssVars: {
        '--translate-x': '0mm',
        '--translate-y': '0mm',
        '--width': '10mm',
        '--height': '10mm',
        '--background-color': '#111111',
        '--fill-visible': '1',
      },
    });
    const b = createLayer('rect', {
      id: 'b',
      cssVars: {
        '--translate-x': '20mm',
        '--translate-y': '0mm',
        '--width': '10mm',
        '--height': '10mm',
        '--background-color': '#111111',
        '--fill-visible': '1',
      },
    });
    const c = createLayer('rect', {
      id: 'c',
      cssVars: {
        '--translate-x': '40mm',
        '--translate-y': '0mm',
        '--width': '10mm',
        '--height': '10mm',
        '--background-color': '#EEEEEE',
        '--fill-visible': '1',
      },
    });
    doc = { ...doc, layers: [...doc.layers, a, b, c] };
    doc = createAndLinkStyle(doc, 'a', 'color');
    const styleId = doc.layers.find((l) => l.id === 'a')!.fillStyleId!;
    const style = doc.styles!.find((s) => s.id === styleId)!;
    doc = {
      ...doc,
      layers: applyStyleToLayers(doc.layers, style, ['b']),
    };

    doc = updateStyle(doc, styleId, { cssVars: { '--background-color': '#0000FF' } });

    expect(doc.layers.find((l) => l.id === 'a')!.cssVars['--background-color']).toBe('#0000FF');
    expect(doc.layers.find((l) => l.id === 'b')!.cssVars['--background-color']).toBe('#0000FF');
    expect(doc.layers.find((l) => l.id === 'c')!.cssVars['--background-color']).toBe('#EEEEEE');
  });

  it('detachStyle clears id but keeps paint', () => {
    const layer = createLayer('text', {
      fillStyleId: 's1',
      cssVars: {
        ...createLayer('text').cssVars,
        '--background-color': '#ABCDEF',
      },
    });
    const next = detachStyle(layer, 'color');
    expect(next.fillStyleId).toBeUndefined();
    expect(next.cssVars['--background-color']).toBe('#ABCDEF');
  });

  it('removeStyle detaches links and drops catalog entry', () => {
    let doc = createEmptyDocument();
    const layer = createLayer('text', {
      id: 't1',
      cssVars: {
        ...createLayer('text').cssVars,
        '--color': '#333333',
        '--font-size': '14pt',
      },
    });
    doc = { ...doc, layers: [...doc.layers, layer] };
    doc = createAndLinkStyle(doc, 't1', 'text');
    const styleId = doc.layers.find((l) => l.id === 't1')!.textStyleId!;
    expect(doc.styles).toHaveLength(1);
    doc = removeStyle(doc, styleId);
    expect(doc.styles).toHaveLength(0);
    expect(doc.layers.find((l) => l.id === 't1')!.textStyleId).toBeUndefined();
    expect(doc.layers.find((l) => l.id === 't1')!.cssVars['--color']).toBe('#333333');
  });

  it('normalizeDocument defaults styles to []', () => {
    const doc = createEmptyDocument();
    const { styles: _drop, ...without } = doc;
    const normalized = normalizeDocument(without as typeof doc);
    expect(normalized.styles).toEqual([]);
  });
});
