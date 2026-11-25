import { describe, expect, it } from 'vitest';
import { createLayer } from '../constants';
import { mergeCanvasHtmlDocuments, renderCanvasHtml } from '../runtime/renderHtml';
import {
  createEmptyDocument,
  mm,
  newId,
  parseMm,
} from '../types';
import { boxCss } from './fixtures';

describe('canvas renderHtml', () => {
  it('renders field bindings and image slots', () => {
    const doc = createEmptyDocument('Test');
    doc.layers.push({
      id: newId(),
      type: 'field',
      name: 'NIS',
      value: '',
      cssVars: boxCss('10mm', '20mm', '40mm', '8mm', { '--color': '#000' }),
      meta: { key: 'NIS', fallback: '-' },
    });
    doc.layers.push({
      id: newId(),
      type: 'imageSlot',
      name: 'Foto 1',
      value: '',
      cssVars: boxCss('10mm', '40mm', '50mm', '40mm', { '--object-fit': 'cover' }),
      meta: { index: 0 },
    });
    doc.layers.push({
      id: newId(),
      type: 'logo',
      name: 'Logo L',
      value: '',
      cssVars: boxCss('5mm', '5mm', '30mm', '12mm'),
      meta: { side: 'left' },
    });

    const html = renderCanvasHtml(doc, {
      data: { NIS: '12345' },
      images: ['data:image/png;base64,aaa'],
      logoLeft: 'data:image/png;base64,logo',
      logoRight: null,
    });

    expect(html).toContain('12345');
    expect(html).toContain('data:image/png;base64,aaa');
    expect(html).toContain('data:image/png;base64,logo');
    expect(html).toContain('@page');
    expect(html).toContain('210mm');
  });

  it('renders screen preview in px', () => {
    const doc = createEmptyDocument('Test');
    doc.layers.push({
      id: newId(),
      type: 'text',
      name: 'T',
      value: 'Hola',
      cssVars: boxCss('10mm', '20mm', '40mm', '8mm', { '--color': '#000' }),
    });
    const html = renderCanvasHtml(
      doc,
      { data: {}, images: [], logoLeft: null, logoRight: null },
      { forScreen: true },
    );
    expect(html).toContain('Hola');
    expect(html).toContain('px');
    expect(html).not.toMatch(/left:\d+(\.\d+)?mm/);
  });

  it('matches LayerNode text box model (padding, justify, pre-wrap, line-height)', () => {
    const doc = createEmptyDocument('Text parity');
    doc.layers.push({
      id: 'text-center',
      type: 'text',
      name: 'T',
      value: 'Linea 1\nLinea 2',
      cssVars: boxCss('10mm', '20mm', '40mm', '16mm', { '--color': '#000', '--text-align': 'center' }),
    });
    const html = renderCanvasHtml(
      doc,
      { data: {}, images: [], logoLeft: null, logoRight: null },
      { forScreen: true },
    );
    const style = html.match(/data-layer="text-center"[^>]*style="([^"]*)"/)?.[1] ?? '';
    expect(style).toContain('padding:2px 6px');
    expect(style).toContain('justify-content:center');
    expect(style).not.toContain('padding:4px');
    expect(html).toMatch(/white-space:\s*pre-wrap/);
    expect(html).toMatch(/line-height:\s*1\.2/);
    expect(html).toContain('Linea 1\nLinea 2');
  });

  it('merges multiple pages', () => {
    const doc = createEmptyDocument('A');
    const a = renderCanvasHtml(doc, { data: {}, images: [], logoLeft: null, logoRight: null });
    const b = renderCanvasHtml(doc, { data: {}, images: [], logoLeft: null, logoRight: null });
    const merged = mergeCanvasHtmlDocuments([a, b]);
    expect(merged.match(/class="page"/g)?.length).toBe(2);
  });

  it('keeps field paint and strips filled-logo placeholder chrome', () => {
    const doc = createEmptyDocument('Clean export');
    const field = createLayer('field', {
      id: 'field-nis',
      meta: { key: 'NIS', fallback: '-' },
      cssVars: boxCss('10mm', '20mm', '40mm', '8mm', {
        '--color': '#000',
        '--background-color': '#f5f5f5',
        '--border': '1px dashed #bbb',
      }),
    });
    const logo = createLayer('logo', {
      id: 'logo-left',
      meta: { side: 'left' },
      cssVars: boxCss('5mm', '5mm', '30mm', '12mm', { '--background-color': '#eef2ff', '--border': '1px dashed #94a3b8' }),
    });
    const rect = createLayer('rect', {
      id: 'rect-box',
      cssVars: boxCss('50mm', '50mm', '20mm', '10mm', {
        '--background-color': '#f8fafc',
        '--border-width': '1px',
        '--border-color': '#cbd5e1',
      }),
    });
    doc.layers.push(field, logo, rect);

    const html = renderCanvasHtml(doc, {
      data: { NIS: '5995193' },
      images: [],
      logoLeft: 'data:image/png;base64,logo',
      logoRight: null,
    });

    const fieldStyle = html.match(/data-layer="field-nis"[^>]*style="([^"]*)"/)?.[1] ?? '';
    const logoStyle = html.match(/data-layer="logo-left"[^>]*style="([^"]*)"/)?.[1] ?? '';
    const rectStyle = html.match(/data-layer="rect-box"[^>]*style="([^"]*)"/)?.[1] ?? '';

    expect(fieldStyle.toLowerCase()).toContain('#f5f5f5');
    expect(fieldStyle).toMatch(/(?:^|;)\s*border:/);
    expect(fieldStyle).toContain('dashed');

    expect(logoStyle).toContain('background-color:transparent');
    expect(logoStyle).not.toMatch(/#eef2ff/i);
    expect(logoStyle).not.toContain('dashed');

    expect(rectStyle).toMatch(/background-color:/);
    expect(rectStyle).not.toContain('background-color:transparent');
    expect(rectStyle).toMatch(/(?:^|;)\s*border:/);
  });

  it('keeps imageSlot layer paint when photo is filled (WYSIWYG)', () => {
    const doc = createEmptyDocument('Slot chrome');
    doc.layers.push(
      createLayer('imageSlot', {
        id: 'slot-0',
        meta: { index: 0 },
        cssVars: boxCss('10mm', '40mm', '50mm', '40mm', {
          '--background-color': '#f1f5f9',
          '--border': '1px dashed #94a3b8',
          '--object-fit': 'cover',
        }),
      }),
    );
    const html = renderCanvasHtml(doc, {
      data: {},
      images: ['data:image/png;base64,foto'],
      logoLeft: null,
      logoRight: null,
    });
    const style = html.match(/data-layer="slot-0"[^>]*style="([^"]*)"/)?.[1] ?? '';
    expect(style.toLowerCase()).toContain('#f1f5f9');
    expect(style).toContain('dashed');
    expect(html).toContain('data:image/png;base64,foto');
  });

  it('matches LayerNode padding for signature and table (px, not mm)', () => {
    const doc = createEmptyDocument('Pad parity');
    doc.layers.push(
      createLayer('signature', { id: 'sig-pad', value: 'Ana' }),
      createLayer('table', {
        id: 'tbl-pad',
        meta: { rowsData: JSON.stringify({ cells: [['A', 'B']], fieldKeys: [[null, null]] }) },
      }),
    );
    const html = renderCanvasHtml(
      doc,
      { data: {}, images: [], logoLeft: null, logoRight: null },
      { forScreen: true },
    );
    expect(html).toContain('padding:1px');
    expect(html).toContain('padding:1px 2px');
    expect(html).not.toContain('padding:1mm');
  });

  it('keeps designed grid cols×rows even when image count would adapt (WYSIWYG)', async () => {
    const { createReportPreset } = await import('../presets/panels');
    const doc = createReportPreset();
    const grid = doc.layers.find((l) => l.type === 'grid')!;
    const designedCols = grid.meta?.cols ?? 3;
    const designedRows = grid.meta?.rows ?? 2;
    const html = renderCanvasHtml(
      doc,
      {
        data: {},
        images: ['a', 'b', 'c', 'd'],
        logoLeft: null,
        logoRight: null,
      },
      { forScreen: true },
    );
    const slots = doc.layers.filter((l) => l.type === 'imageSlot');
    expect(slots.length).toBe(designedCols * designedRows);
    const slot0 = slots.find((s) => s.meta?.index === 0)!;
    const style = html.match(new RegExp(`data-layer="${slot0.id}"[^>]*style="([^"]*)"`))?.[1] ?? '';
    const x = Math.round(parseMm(slot0.cssVars['--translate-x']) * (96 / 25.4));
    expect(style).toContain(`left:${x}px`);
  });

  it('empty field uses fieldDesignLabel like LayerNode', () => {
    const doc = createEmptyDocument('Field label');
    doc.layers.push(
      createLayer('field', {
        id: 'f-empty-fb',
        meta: { key: 'NIS', fallback: '' },
        cssVars: boxCss('10mm', '20mm', '40mm', '8mm'),
      }),
    );
    const html = renderCanvasHtml(doc, {
      data: {},
      images: [],
      logoLeft: null,
      logoRight: null,
    });
    expect(html).toContain('{{ NIS }}');
  });

  it('legacy --border-style dotted renders in export (saved templates)', () => {
    const doc = createEmptyDocument('Legacy border');
    doc.layers.push(
      createLayer('field', {
        id: 'legacy-field',
        meta: { key: 'SECTOR', fallback: '-' },
        cssVars: boxCss('10mm', '20mm', '40mm', '8mm', {
          '--background-color': '#fefefe',
          '--border-width': '1px',
          '--border-color': '#888888',
          '--border-style': 'dotted',
        }),
      }),
    );
    const html = renderCanvasHtml(doc, { data: {}, images: [], logoLeft: null, logoRight: null }, { forScreen: true });
    const style = html.match(/data-layer="legacy-field"[^>]*style="([^"]*)"/)?.[1] ?? '';
    expect(style).toMatch(/(?:^|;)\s*border:/);
    expect(style).toContain('dotted');
  });

  it('logo img uses layer object-fit from cssVars', () => {
    const doc = createEmptyDocument('Logo fit');
    doc.layers.push(
      createLayer('logo', {
        id: 'logo-cover',
        meta: { side: 'left' },
        cssVars: boxCss('5mm', '5mm', '30mm', '12mm', { '--object-fit': 'cover' }),
      }),
    );
    const html = renderCanvasHtml(doc, {
      data: {},
      images: [],
      logoLeft: 'data:image/png;base64,logo',
      logoRight: null,
    });
    expect(html).toMatch(/alt="logo"[^>]*object-fit:cover/);
  });

  it('checkbox and signature content inherit layer styles (no hardcoded black box)', () => {
    const doc = createEmptyDocument('Widgets');
    doc.layers.push(
      createLayer('checkbox', {
        id: 'cb-1',
        meta: { checked: true },
        cssVars: boxCss('10mm', '10mm', '6mm', '6mm', {
          '--border-width': '2px',
          '--border-color': '#0e8fd6',
          '--color': '#0e8fd6',
          '--font-size': '12pt',
        }),
      }),
      createLayer('signature', {
        id: 'sig-1',
        value: 'Ana Ruiz',
        cssVars: boxCss('10mm', '30mm', '60mm', '20mm', { '--color': '#334155', '--font-size': '9pt' }),
      }),
    );
    const html = renderCanvasHtml(doc, {
      data: {},
      images: [],
      logoLeft: null,
      logoRight: null,
    });
    const cbInner = html.match(/data-layer="cb-1"[^>]*>[\s\S]*?<\/div>/)?.[0] ?? '';
    expect(cbInner).toContain('✓');
    expect(cbInner).not.toContain('border:1px solid #000');
    expect(cbInner).toMatch(/color:#0e8fd6|color:inherit/);
    expect(html).toContain('Ana Ruiz');
    expect(html).toMatch(/font-size:9pt/);
    expect(html).toMatch(/color:#334155/);
  });

  it('clipped shapes force border-radius 0 like LayerNode', () => {
    const doc = createEmptyDocument('Clip');
    doc.layers.push(
      createLayer('arrow', {
        id: 'arrow-1',
        cssVars: boxCss('10mm', '10mm', '40mm', '20mm', { '--background-color': '#000', '--border-radius': '8px' }),
      }),
    );
    const html = renderCanvasHtml(doc, {
      data: {},
      images: [],
      logoLeft: null,
      logoRight: null,
    });
    const style = html.match(/data-layer="arrow-1"[^>]*style="([^"]*)"/)?.[1] ?? '';
    expect(style).toContain('clip-path:');
    expect(style).toMatch(/border-radius:\s*0/);
  });

  it('renders distinct left and right logos when sides differ', () => {
    const doc = createEmptyDocument('Logos');
    doc.layers.push(
      createLayer('logo', {
        meta: { side: 'left' },
        cssVars: boxCss('5mm', '5mm', '30mm', '12mm'),
      }),
      createLayer('logo', {
        meta: { side: 'right' },
        cssVars: boxCss('160mm', '5mm', '30mm', '12mm'),
      }),
    );
    const html = renderCanvasHtml(doc, {
      data: {},
      images: [],
      logoLeft: 'data:image/png;base64,LEFT',
      logoRight: 'data:image/png;base64,RIGHT',
    });
    expect(html).toContain('data:image/png;base64,LEFT');
    expect(html).toContain('data:image/png;base64,RIGHT');
  });

  it('uses logoLeft for both layers when they share side left', () => {
    const doc = createEmptyDocument('Conflict');
    doc.layers.push(
      createLayer('logo', { meta: { side: 'left' } }),
      createLayer('logo', { meta: { side: 'left' } }),
    );
    const html = renderCanvasHtml(doc, {
      data: {},
      images: [],
      logoLeft: 'data:image/png;base64,SAME',
      logoRight: 'data:image/png;base64,OTHER',
    });
    expect(html.match(/data:image\/png;base64,SAME/g)?.length).toBe(2);
    expect(html).not.toContain('data:image/png;base64,OTHER');
  });
});

describe('render checkbox and table', () => {
  it('renders checked checkbox and table cells', () => {
    const doc = createEmptyDocument('Form');
    doc.layers.push({
      id: newId(),
      type: 'checkbox',
      name: 'A',
      value: '',
      cssVars: boxCss('10mm', '10mm', '6mm', '6mm'),
      meta: { key: 'SERVICIO_A' },
    });
    doc.layers.push({
      id: newId(),
      type: 'table',
      name: 'T',
      value: '',
      cssVars: boxCss('10mm', '20mm', '100mm', '30mm'),
      meta: { rowsData: JSON.stringify({ cells: [['A', 'B'], ['1', '2']] }) },
    });
    const html = renderCanvasHtml(doc, {
      data: { SERVICIO_A: 'si' },
      images: [],
      logoLeft: null,
      logoRight: null,
    });
    expect(html).toContain('✓');
    expect(html).toContain('<table');
    expect(html).toContain('>A</td>');
  });
});
