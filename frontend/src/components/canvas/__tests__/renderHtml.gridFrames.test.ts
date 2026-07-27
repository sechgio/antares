import { describe, expect, it } from 'vitest';
import { createLayer } from '../constants';
import { applyGridToImageSlots } from '../ops/gridLayout';
import { renderMultiPageHtml } from '../ops/pages';
import { createEmptyDocument, mm, newId, type CanvasLayer } from '../types';

/** Preset-style grid: real stroke on the grid box + real stroke on slots (like addPhotoGrid). */
function docWithPresetGrid() {
  const doc = createEmptyDocument('Repro');
  const gridId = newId();
  const grid: CanvasLayer = {
    id: gridId,
    type: 'grid',
    name: 'Cuadrícula fotos',
    value: '',
    pageIndex: 0,
    cssVars: {
      '--width': mm(194),
      '--height': mm(185),
      '--translate-x': mm(8),
      '--translate-y': mm(95),
      '--background-color': 'transparent',
      '--border-width': '2px',
      '--border-color': '#333333',
    },
    meta: { cols: 2, rows: 2, gapMm: 2 },
  };
  const slots: CanvasLayer[] = [];
  for (let i = 0; i < 4; i += 1) {
    slots.push({
      id: newId(),
      type: 'imageSlot',
      name: `Foto ${i + 1}`,
      value: '',
      pageIndex: 0,
      parentId: gridId,
      cssVars: {
        '--width': mm(40),
        '--height': mm(40),
        '--translate-x': mm(8),
        '--translate-y': mm(95),
        '--background-color': '#fafafa',
        '--border-width': '1px',
        '--border-color': '#e0e0e0',
        '--object-fit': 'cover',
      },
      meta: { index: i },
    });
  }
  const layers = applyGridToImageSlots([...doc.layers, grid, ...slots], gridId);
  return { ...doc, layers };
}

/** Editor-style drawn grid + slots: dashed placeholder shorthand only. */
function docWithDrawnGrid() {
  const doc = createEmptyDocument('Repro drawn');
  const grid = createLayer('grid');
  grid.pageIndex = 0;
  const slots: CanvasLayer[] = [];
  for (let i = 0; i < 4; i += 1) {
    slots.push(
      createLayer('imageSlot', {
        name: `Foto ${i + 1}`,
        pageIndex: 0,
        parentId: grid.id,
        meta: { index: i },
      }),
    );
  }
  const layers = applyGridToImageSlots([...doc.layers, grid, ...slots], grid.id);
  return { ...doc, layers };
}

function styleOf(html: string, layerId: string): string {
  return html.match(new RegExp(`data-layer="${layerId}"[^>]*style="([^"]*)"`))?.[1] ?? '';
}

describe('renderHtml grid frames (Generar preview/export)', () => {
  it('preset grid keeps its panel frame in export (no images)', () => {
    const doc = docWithPresetGrid();
    const gridId = doc.layers.find((l) => l.type === 'grid')!.id;
    const html = renderMultiPageHtml(
      doc,
      { data: {}, images: [], logoLeft: null, logoRight: null },
      { forScreen: true },
    );
    const gridStyle = styleOf(html, gridId);
    expect(gridStyle).toContain('border:2px solid #333333');
  });

  it('preset grid keeps its panel frame in export (with images)', () => {
    const doc = docWithPresetGrid();
    const gridId = doc.layers.find((l) => l.type === 'grid')!.id;
    const html = renderMultiPageHtml(
      doc,
      {
        data: {},
        images: ['data:image/png;base64,AAA', 'data:image/png;base64,BBB'],
        logoLeft: null,
        logoRight: null,
      },
      { forScreen: true },
    );
    expect(styleOf(html, gridId)).toContain('border:2px solid #333333');
  });

  it('filled preset slots keep their real stroke frame', () => {
    const doc = docWithPresetGrid();
    const slot = doc.layers.find((l) => l.type === 'imageSlot' && l.meta?.index === 0)!;
    const html = renderMultiPageHtml(
      doc,
      { data: {}, images: ['data:image/png;base64,AAA'], logoLeft: null, logoRight: null },
      { forScreen: true },
    );
    const slotStyle = styleOf(html, slot.id);
    expect(slotStyle).toContain('border:1px solid #E0E0E0');
    expect(slotStyle).toContain('background-color:transparent');
  });

  it('drawn grid stays invisible in export (placeholder chrome dropped)', () => {
    const doc = docWithDrawnGrid();
    const gridId = doc.layers.find((l) => l.type === 'grid')!.id;
    const html = renderMultiPageHtml(
      doc,
      { data: {}, images: [], logoLeft: null, logoRight: null },
      { forScreen: true },
    );
    const gridStyle = styleOf(html, gridId);
    expect(gridStyle).not.toContain('dashed');
    expect(gridStyle).not.toMatch(/(?:^|;)\s*border:/);
  });

  it('filled drawn slots stay frameless in export (placeholder chrome dropped)', () => {
    const doc = docWithDrawnGrid();
    const slot = doc.layers.find((l) => l.type === 'imageSlot' && l.meta?.index === 0)!;
    const html = renderMultiPageHtml(
      doc,
      { data: {}, images: ['data:image/png;base64,AAA'], logoLeft: null, logoRight: null },
      { forScreen: true },
    );
    const slotStyle = styleOf(html, slot.id);
    expect(slotStyle).not.toContain('dashed');
    expect(slotStyle).not.toMatch(/(?:^|;)\s*border:/);
    expect(slotStyle).toContain('background-color:transparent');
  });
});
