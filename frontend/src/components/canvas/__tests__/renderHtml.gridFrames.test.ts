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
    expect(slotStyle.toLowerCase()).toContain('#fafafa');
  });

  it('drawn grid keeps placeholder frame in export (WYSIWYG)', () => {
    const doc = docWithDrawnGrid();
    const gridId = doc.layers.find((l) => l.type === 'grid')!.id;
    const html = renderMultiPageHtml(
      doc,
      { data: {}, images: [], logoLeft: null, logoRight: null },
      { forScreen: true },
    );
    const gridStyle = styleOf(html, gridId);
    expect(gridStyle).toContain('dashed');
    expect(gridStyle).toMatch(/(?:^|;)\s*border:/);
  });

  it('filled drawn slots keep placeholder frame in export (WYSIWYG)', () => {
    const doc = docWithDrawnGrid();
    const slot = doc.layers.find((l) => l.type === 'imageSlot' && l.meta?.index === 0)!;
    const html = renderMultiPageHtml(
      doc,
      { data: {}, images: ['data:image/png;base64,AAA'], logoLeft: null, logoRight: null },
      { forScreen: true },
    );
    const slotStyle = styleOf(html, slot.id);
    expect(slotStyle).toContain('dashed');
    expect(slotStyle).toMatch(/(?:^|;)\s*border:/);
    expect(slotStyle.toLowerCase()).toContain('#f1f5f9');
  });
});

describe('renderHtml Panel fotográfico WYSIWYG', () => {
  it('keeps field/logo/slot chrome and dotted borders like design', async () => {
    const { createReportPreset } = await import('../presets/panels');
    const doc = createReportPreset();
    const html = renderMultiPageHtml(
      doc,
      { data: {}, images: [], logoLeft: null, logoRight: null },
      { forScreen: true },
    );

    const field = doc.layers.find((l) => l.type === 'field' && l.meta?.key === 'NIS')!;
    const logo = doc.layers.find((l) => l.type === 'logo' && l.meta?.side !== 'right')!;
    const slot = doc.layers.find((l) => l.type === 'imageSlot' && l.meta?.index === 0)!;

    const fieldStyle = styleOf(html, field.id);
    expect(fieldStyle.toLowerCase()).toContain('#fefefe');
    expect(fieldStyle).toContain('dotted');
    expect(fieldStyle).toMatch(/(?:^|;)\s*border:/);
    expect(html).toMatch(new RegExp(`data-layer="${field.id}"[^>]*>.*?<span[^>]*>-</span>`, 's'));

    const logoStyle = styleOf(html, logo.id);
    expect(logoStyle.toLowerCase()).toContain('#f8fafc');
    expect(logoStyle).toMatch(/(?:^|;)\s*border:/);
    expect(html).toContain('Logo L');
    expect(html).toContain('font-family:ui-monospace');

    const slotStyle = styleOf(html, slot.id);
    expect(slotStyle.toLowerCase()).toContain('#fafafa');
    expect(slotStyle).toMatch(/(?:^|;)\s*border:/);
    expect(html).toContain('Foto 1');
    expect(html).toMatch(/font-size:10px/);
  });
});

describe('renderHtml stored grid geometry (D7)', () => {
  it('keeps manually moved slot translate in export (no re-layout)', () => {
    const doc = docWithPresetGrid();
    const slot = doc.layers.find((l) => l.type === 'imageSlot' && l.meta?.index === 0)!;
    const movedX = mm(42);
    const movedY = mm(120);
    doc.layers = doc.layers.map((l) =>
      l.id === slot.id
        ? {
            ...l,
            cssVars: { ...l.cssVars, '--translate-x': movedX, '--translate-y': movedY },
          }
        : l,
    );
    const html = renderMultiPageHtml(
      doc,
      { data: {}, images: [], logoLeft: null, logoRight: null },
      { forScreen: true },
    );
    const slotStyle = styleOf(html, slot.id);
    // forScreen uses px; 42mm ≈ 159px at 96dpi
    expect(slotStyle).toMatch(/left:\s*159px/);
    expect(slotStyle).toMatch(/top:\s*454px/);
  });
});

describe('renderHtml empty image placeholder (D8)', () => {
  it('renders Imagen chrome for empty image layers', () => {
    const doc = createEmptyDocument('Empty image');
    const image = createLayer('image', { id: 'img-empty', value: '' });
    doc.layers.push(image);
    const html = renderMultiPageHtml(
      doc,
      { data: {}, images: [], logoLeft: null, logoRight: null },
      { forScreen: true },
    );
    expect(html).toContain('Imagen');
    expect(html).toContain('font-family:ui-monospace');
  });
});
