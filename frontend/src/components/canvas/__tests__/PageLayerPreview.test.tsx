import { describe, expect, it } from 'vitest';
import { createLayer } from '../constants';
import PageLayerPreview, { documentWithFill } from '../editor/PageLayerPreview';
import { planMultiPageDocuments } from '../ops/pages';
import { createEmptyDocument, mm, newId } from '../types';
import { render } from '@testing-library/react';
import type { FillContext } from '../runtime/renderHtml';

describe('documentWithFill', () => {
  it('maps field/logo/slot/checkbox/signature from FillContext for LayerNode preview', () => {
    const doc = createEmptyDocument('Fill');
    doc.layers.push(
      createLayer('field', { id: 'f1', meta: { key: 'NIS', fallback: '-' } }),
      createLayer('logo', { id: 'l1', meta: { side: 'left' } }),
      createLayer('imageSlot', { id: 's1', meta: { index: 0 } }),
      createLayer('checkbox', { id: 'c1', meta: { key: 'OK', checked: false } }),
      createLayer('signature', { id: 'g1', meta: { key: 'FIRMA' }, value: '' }),
    );
    const ctx: FillContext = {
      data: { NIS: '99', OK: 'si', FIRMA: 'Ana' },
      images: ['data:image/png;base64,AAA'],
      logoLeft: 'data:image/png;base64,LOGO',
      logoRight: null,
    };
    const filled = documentWithFill(doc, ctx);
    expect(filled.layers.find((l) => l.id === 'f1')?.meta?.fallback).toBe('99');
    expect(filled.layers.find((l) => l.id === 'l1')?.type).toBe('image');
    expect(filled.layers.find((l) => l.id === 'l1')?.value).toContain('LOGO');
    expect(filled.layers.find((l) => l.id === 's1')?.type).toBe('image');
    expect(filled.layers.find((l) => l.id === 'c1')?.meta?.checked).toBe(true);
    expect(filled.layers.find((l) => l.id === 'g1')?.value).toBe('Ana');
  });

  it('rewrites table cells from fieldKeys when data is non-empty', () => {
    const doc = createEmptyDocument('Table fill');
    doc.layers.push(
      createLayer('table', {
        id: 't1',
        meta: {
          rowsData: JSON.stringify({
            cells: [['NIS', '-'], ['OT', 'fallback']],
            fieldKeys: [[null, 'NIS'], [null, 'OT']],
          }),
        },
      }),
    );
    const filled = documentWithFill(doc, {
      data: { NIS: '4587', OT: '' },
      images: [],
      logoLeft: null,
      logoRight: null,
    });
    const rows = JSON.parse(filled.layers.find((l) => l.id === 't1')!.meta!.rowsData!);
    expect(rows.cells[0][1]).toBe('4587');
    // Empty data keeps designed cell (same rule as renderHtml).
    expect(rows.cells[1][1]).toBe('fallback');
  });
});

describe('PageLayerPreview', () => {
  it('renders layers with the same LayerNode chrome as Design', () => {
    const doc = createEmptyDocument('Preview');
    doc.layers.push(
      createLayer('text', { value: 'TÍTULO' }),
      createLayer('logo', { meta: { side: 'left' } }),
      createLayer('imageSlot', { meta: { index: 0 } }),
    );
    const { container } = render(<PageLayerPreview document={doc} scale={1} />);
    const page = container.querySelector('[data-testid="page-layer-preview"]');
    expect(page).toBeTruthy();
    expect(page?.textContent).toContain('TÍTULO');
    expect(page?.textContent).toContain('Logo L');
    expect(page?.textContent).toContain('Foto 1');
  });

  it('filters to the requested pageIndex (no multi-page stacking)', () => {
    const doc = createEmptyDocument('Multi');
    doc.pages = [
      { id: newId(), name: 'Página 1' },
      { id: newId(), name: 'Página 2' },
    ];
    doc.layers.push(
      createLayer('text', { id: 'p0', value: 'SOLO_PAGINA_0', pageIndex: 0 }),
      createLayer('text', { id: 'p1', value: 'SOLO_PAGINA_1', pageIndex: 1 }),
    );
    const { container } = render(<PageLayerPreview document={doc} pageIndex={0} scale={1} />);
    const text = container.querySelector('[data-testid="page-layer-preview"]')?.textContent ?? '';
    expect(text).toContain('SOLO_PAGINA_0');
    expect(text).not.toContain('SOLO_PAGINA_1');
  });
});

describe('planMultiPageDocuments', () => {
  it('yields 3 page docs for 9 images on a 2×2 grid (4 slots/page)', () => {
    const doc = createEmptyDocument('Grid pages');
    const gridId = newId();
    doc.layers.push({
      id: gridId,
      type: 'grid',
      name: 'Grid',
      value: '',
      pageIndex: 0,
      cssVars: {
        '--width': mm(100),
        '--height': mm(100),
        '--translate-x': mm(0),
        '--translate-y': mm(0),
      },
      meta: { cols: 2, rows: 2 },
    });
    for (let i = 0; i < 4; i += 1) {
      doc.layers.push(
        createLayer('imageSlot', {
          id: `slot-${i}`,
          pageIndex: 0,
          parentId: gridId,
          meta: { index: i },
        }),
      );
    }
    const images = Array.from({ length: 9 }, (_, i) => `data:image/png;base64,IMG${i}`);
    const plan = planMultiPageDocuments(doc, {
      data: {},
      images,
      logoLeft: null,
      logoRight: null,
    });
    expect(plan).toHaveLength(3);
    expect(plan.every((p) => p.pageDoc.layers.every((l) => (l.pageIndex ?? 0) === 0))).toBe(true);
  });
});
