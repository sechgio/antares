import { describe, expect, it } from 'vitest';
import { createLayer } from '../constants';
import { addPage } from '../ops/pages';
import { collectDemoFieldKeys } from '../runtime/demoFill';
import { renderMultiPageHtml } from '../runtime/planning';
import type { FillContext } from '../runtime/renderHtml';
import { createEmptyDocument, mm, newId } from '../types';

const demoContext = (doc: ReturnType<typeof createEmptyDocument>): FillContext => ({
  data: Object.fromEntries(collectDemoFieldKeys(doc).map((key) => [key, '45871203'])),
  images: [],
  logoLeft: null,
  logoRight: null,
});

describe('demoFill', () => {
  it('collectDemoFieldKeys collects field, checkbox, logo and image slot keys', () => {
    const doc = createEmptyDocument('Demo');
    doc.layers.push(
      { ...createLayer('field'), id: newId(), meta: { key: 'NIS', fallback: '-' } },
      { ...createLayer('field'), id: newId(), meta: { key: 'DIRECCION', fallback: '-' } },
      { ...createLayer('checkbox'), id: newId(), meta: { key: 'OK', checked: false } },
      { ...createLayer('logo'), id: newId(), meta: { side: 'left' } },
      { ...createLayer('logo'), id: newId(), meta: { side: 'right' } },
      { ...createLayer('imageSlot'), id: newId(), meta: { index: 0 } },
      { ...createLayer('imageSlot'), id: newId(), meta: { index: 1 } },
    );

    expect(collectDemoFieldKeys(doc).sort()).toEqual(['DIRECCION', 'NIS', 'OK'].sort());
  });

  it('collectDemoFieldKeys includes signature and table keys', () => {
    const doc = createEmptyDocument('Keys');
    doc.layers.push(
      { ...createLayer('signature'), id: newId(), meta: { key: 'FIRMA' } },
      {
        ...createLayer('table'),
        id: newId(),
        meta: {
          rowsData: JSON.stringify({
            cells: [['a', 'b']],
            fieldKeys: [['NIS', null]],
          }),
        },
      },
    );
    expect(collectDemoFieldKeys(doc).sort()).toEqual(['FIRMA', 'NIS'].sort());
  });

  it('the production renderer embeds demo field values', () => {
    const doc = createEmptyDocument('Demo');
    doc.layers.push({
      ...createLayer('field'),
      id: newId(),
      meta: { key: 'NIS', fallback: '-' },
      cssVars: {
        '--width': '40mm',
        '--height': '8mm',
        '--translate-x': '10mm',
        '--translate-y': '10mm',
      },
    });
    const html = renderMultiPageHtml(doc, demoContext(doc), { forScreen: true });
    expect(html).toContain('45871203');
  });

  it('the production renderer keeps demo design pages separate (no layer stacking)', () => {
    let doc = createEmptyDocument('Multi');
    doc.layers.push({
      id: 'p0-text',
      type: 'text',
      name: 'P0',
      value: 'PaginaUno',
      pageIndex: 0,
      cssVars: {
        '--width': mm(40),
        '--height': mm(8),
        '--translate-x': mm(10),
        '--translate-y': mm(10),
        '--color': '#000',
      },
    });
    doc = addPage(doc);
    doc.layers.push({
      id: 'p1-text',
      type: 'text',
      name: 'P1',
      value: 'PaginaDos',
      pageIndex: 1,
      cssVars: {
        '--width': mm(40),
        '--height': mm(8),
        '--translate-x': mm(10),
        '--translate-y': mm(10),
        '--color': '#000',
      },
    });

    const html = renderMultiPageHtml(doc, demoContext(doc), { forScreen: true });
    expect(html.match(/class="page"/g)?.length).toBe(2);
    expect(html).toContain('px');
    expect(html).not.toMatch(/left:\d+(\.\d+)?mm/);

    const pageStarts = [...html.matchAll(/class="page"/g)].map((m) => m.index ?? -1);
    const p0 = html.indexOf('data-layer="p0-text"');
    const p1 = html.indexOf('data-layer="p1-text"');
    expect(pageStarts).toHaveLength(2);
    expect(p0).toBeGreaterThan(pageStarts[0]);
    expect(p0).toBeLessThan(pageStarts[1]);
    expect(p1).toBeGreaterThan(pageStarts[1]);
  });
});
