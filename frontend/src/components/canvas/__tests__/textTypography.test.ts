import { describe, expect, it } from 'vitest';
import { createLayer } from '../constants';
import { cssVarsToStyleParts } from '../ops/layerStyle';
import { renderMultiPageHtml } from '../runtime/planning';
import { createEmptyDocument, mm, type CanvasLayer } from '../types';
import { boxCss } from './fixtures';


function docWithTextLayer(overrides: Partial<CanvasLayer['cssVars']> = {}): {
  doc: ReturnType<typeof createEmptyDocument>;
  layerId: string;
} {
  const doc = createEmptyDocument('Tipografía');
  const text = createLayer('text');
  text.pageIndex = 0;
  text.value = 'Hola Mundo';
  text.cssVars = {
    ...text.cssVars,
    '--width': mm(60),
    '--height': mm(10),
    '--translate-x': mm(20),
    '--translate-y': mm(30),
    ...overrides,
  };
  return { doc: { ...doc, layers: [...doc.layers, text] }, layerId: text.id };
}

function spanStyleOf(html: string, layerId: string): string {
  return html.match(new RegExp(`data-layer="${layerId}"[^>]*><span style="([^"]*)"`))?.[1] ?? '';
}

describe('Text typography — cssVarsToStyleParts', () => {
  it('emits font-style, text-decoration, letter-spacing, text-transform', () => {
    const parts = cssVarsToStyleParts(boxCss('20mm', '30mm', '60mm', '10mm', {
      '--font-style': 'italic',
      '--text-decoration': 'underline',
      '--letter-spacing': '0.5px',
      '--text-transform': 'uppercase',
    }));
    const css = parts.join(';');
    expect(css).toContain('font-style:italic');
    expect(css).toContain('text-decoration:underline');
    expect(css).toContain('letter-spacing:0.5px');
    expect(css).toContain('text-transform:uppercase');
  });

  it('skips text-transform:none and empty values', () => {
    const parts = cssVarsToStyleParts(boxCss('20mm', '30mm', '60mm', '10mm', { '--text-transform': 'none', '--font-style': '' }));
    const css = parts.join(';');
    expect(css).not.toContain('text-transform');
    expect(css).not.toContain('font-style');
  });
});

describe('Text typography — renderHtml export parity', () => {
  it('renders italic/underline/letter-spacing/text-transform in the text span', () => {
    const { doc, layerId } = docWithTextLayer({
      '--font-style': 'italic',
      '--text-decoration': 'underline',
      '--letter-spacing': '0.5px',
      '--text-transform': 'uppercase',
    });
    const html = renderMultiPageHtml(
      doc,
      { data: {}, images: [], logoLeft: null, logoRight: null },
      { forScreen: true },
    );
    const spanStyle = spanStyleOf(html, layerId);
    expect(spanStyle).toContain('font-style:italic');
    expect(spanStyle).toContain('text-decoration:underline');
    expect(spanStyle).toContain('letter-spacing:0.5px');
    expect(spanStyle).toContain('text-transform:uppercase');
  });

  it('applies vertical alignment to the layer box (align-items)', () => {
    const { doc, layerId } = docWithTextLayer({ '--text-valign': 'flex-end' });
    const html = renderMultiPageHtml(
      doc,
      { data: {}, images: [], logoLeft: null, logoRight: null },
      { forScreen: true },
    );
    const boxStyle =
      html.match(new RegExp(`data-layer="${layerId}"[^>]*style="([^"]*)"`))?.[1] ?? '';
    expect(boxStyle).toContain('align-items:flex-end');
  });

  it('defaults vertical alignment to center when --text-valign is unset', () => {
    const { doc, layerId } = docWithTextLayer();
    const html = renderMultiPageHtml(
      doc,
      { data: {}, images: [], logoLeft: null, logoRight: null },
      { forScreen: true },
    );
    const boxStyle =
      html.match(new RegExp(`data-layer="${layerId}"[^>]*style="([^"]*)"`))?.[1] ?? '';
    expect(boxStyle).toContain('align-items:center');
  });
});
