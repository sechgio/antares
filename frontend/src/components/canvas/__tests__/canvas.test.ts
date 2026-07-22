import { describe, expect, it } from 'vitest';
import { createLayer } from '../constants';
import { DEFAULT_GRID_RULES, layoutGridSlots, resolveGridLayout } from '../ops/gridLayout';
import {
  alignLayers,
  bringToFront,
  duplicateLayers,
  nudgeLayers,
  sendToBack,
  setLayerLocked,
} from '../ops/layerOps';
import { addPage, chunkImages, duplicatePage, removePage, renamePage } from '../ops/pages';
import {
  clientToMm,
  isClickPlace,
  isPlaceTool,
  mmToScreenPx,
  normalizeDrawRect,
  scaleCssLength,
} from '../ops/drawHelpers';
import { clampZoom, fitZoomForViewport, zoomAtCursor } from '../ops/viewportNav';
import { buildRowData, matchesRecordId } from '../runtime/excel';
import { mergeCanvasHtmlDocuments, renderCanvasHtml } from '../runtime/renderHtml';
import { createEmptyDocument, newId, normalizeDocument, parseMm } from '../types';
import { CANVAS_SHORTCUTS } from '../shortcuts';

describe('canvas renderHtml', () => {
  it('renders field bindings and image slots', () => {
    const doc = createEmptyDocument('Test');
    doc.layers.push({
      id: newId(),
      type: 'field',
      name: 'NIS',
      value: '',
      cssVars: {
        '--width': '40mm',
        '--height': '8mm',
        '--translate-x': '10mm',
        '--translate-y': '20mm',
        '--color': '#000',
      },
      meta: { key: 'NIS', fallback: '-' },
    });
    doc.layers.push({
      id: newId(),
      type: 'imageSlot',
      name: 'Foto 1',
      value: '',
      cssVars: {
        '--width': '50mm',
        '--height': '40mm',
        '--translate-x': '10mm',
        '--translate-y': '40mm',
        '--object-fit': 'cover',
      },
      meta: { index: 0 },
    });
    doc.layers.push({
      id: newId(),
      type: 'logo',
      name: 'Logo L',
      value: '',
      cssVars: {
        '--width': '30mm',
        '--height': '12mm',
        '--translate-x': '5mm',
        '--translate-y': '5mm',
      },
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
      cssVars: {
        '--width': '40mm',
        '--height': '8mm',
        '--translate-x': '10mm',
        '--translate-y': '20mm',
        '--color': '#000',
      },
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

  it('merges multiple pages', () => {
    const doc = createEmptyDocument('A');
    const a = renderCanvasHtml(doc, { data: {}, images: [], logoLeft: null, logoRight: null });
    const b = renderCanvasHtml(doc, { data: {}, images: [], logoLeft: null, logoRight: null });
    const merged = mergeCanvasHtmlDocuments([a, b]);
    expect(merged.match(/class="page"/g)?.length).toBe(2);
  });
});

describe('canvas excel helpers', () => {
  it('matches record id filenames', () => {
    expect(matchesRecordId('ABC-1.jpg', 'ABC')).toBe(true);
    expect(matchesRecordId('ABC_2.png', 'ABC')).toBe(true);
    expect(matchesRecordId('XYZ-1.jpg', 'ABC')).toBe(false);
  });

  it('builds row data from mappings', () => {
    const data = buildRowData({ ColNIS: '99', Other: 'x' }, { NIS: 'ColNIS' });
    expect(data.NIS).toBe('99');
  });
});

describe('createLayer', () => {
  it('creates field with default key', () => {
    const layer = createLayer('field');
    expect(layer.type).toBe('field');
    expect(layer.meta?.key).toBeTruthy();
  });

  it('creates new layer types', () => {
    expect(createLayer('grid').type).toBe('grid');
    expect(createLayer('group').type).toBe('group');
    expect(createLayer('table').type).toBe('table');
    expect(createLayer('checkbox').type).toBe('checkbox');
    expect(createLayer('signature').type).toBe('signature');
    expect(createLayer('line').type).toBe('line');
    expect(createLayer('ellipse').type).toBe('ellipse');
    expect(createLayer('arrow').type).toBe('arrow');
    expect(createLayer('polygon').type).toBe('polygon');
    expect(createLayer('star').type).toBe('star');
  });
});

describe('layerOps', () => {
  const baseLayers = () => {
    const doc = createEmptyDocument('Ops');
    const text = createLayer('text', { cssVars: { ...createLayer('text').cssVars, '--translate-x': '10mm', '--translate-y': '20mm' } });
    const rect = createLayer('rect', { cssVars: { ...createLayer('rect').cssVars, '--translate-x': '30mm', '--translate-y': '40mm' } });
    return [...doc.layers, text, rect];
  };

  it('duplicateLayers creates new ids and offsets', () => {
    const layers = baseLayers();
    const source = layers[1];
    const { layers: next, newIds } = duplicateLayers(layers, [source.id]);
    expect(newIds).toHaveLength(1);
    expect(newIds[0]).not.toBe(source.id);
    const dup = next.find((l) => l.id === newIds[0])!;
    expect(parseMm(dup.cssVars['--translate-x'])).toBe(parseMm(source.cssVars['--translate-x']) + 5);
    expect(parseMm(dup.cssVars['--translate-y'])).toBe(parseMm(source.cssVars['--translate-y']) + 5);
  });

  it('skips locked frames when duplicating', () => {
    const layers = baseLayers();
    const frame = layers[0];
    const { layers: next, newIds } = duplicateLayers(layers, [frame.id]);
    expect(newIds).toHaveLength(0);
    expect(next).toHaveLength(layers.length);
  });

  it('bringToFront and sendToBack reorder layers', () => {
    const layers = baseLayers();
    const text = layers[1];
    const front = bringToFront(layers, [text.id]);
    expect(front[front.length - 1].id).toBe(text.id);
    const back = sendToBack(front, [text.id]);
    expect(back[1].id).toBe(text.id);
  });

  it('alignLayers left', () => {
    const layers = baseLayers();
    const ids = layers.slice(1).map((l) => l.id);
    const aligned = alignLayers(layers, ids, 'left');
    const xs = aligned.slice(1).map((l) => parseMm(l.cssVars['--translate-x']));
    expect(new Set(xs).size).toBe(1);
    expect(xs[0]).toBe(10);
  });

  it('alignLayers single selection against frame', () => {
    const layers = baseLayers();
    const text = layers[1];
    text.cssVars['--translate-x'] = '40mm';
    const aligned = alignLayers(layers, [text.id], 'left');
    const moved = aligned.find((l) => l.id === text.id)!;
    expect(parseMm(moved.cssVars['--translate-x'])).toBe(0);
  });

  it('nudgeLayers moves by delta', () => {
    const layers = baseLayers();
    const text = layers[1];
    const nudged = nudgeLayers(layers, [text.id], 3, -2);
    const moved = nudged.find((l) => l.id === text.id)!;
    expect(parseMm(moved.cssVars['--translate-x'])).toBe(13);
    expect(parseMm(moved.cssVars['--translate-y'])).toBe(18);
  });

  it('nudgeLayers allows negative coordinates', () => {
    const layers = baseLayers();
    const text = layers[1];
    const nudged = nudgeLayers(layers, [text.id], -20, -30);
    const moved = nudged.find((l) => l.id === text.id)!;
    expect(parseMm(moved.cssVars['--translate-x'])).toBeLessThan(0);
    expect(parseMm(moved.cssVars['--translate-y'])).toBeLessThan(0);
  });
});

describe('gridLayout', () => {
  it('resolveGridLayout for 4, 6, 9 images', () => {
    expect(resolveGridLayout(4, DEFAULT_GRID_RULES, { cols: 1, rows: 1 })).toEqual({ cols: 2, rows: 2 });
    expect(resolveGridLayout(6, DEFAULT_GRID_RULES, { cols: 1, rows: 1 })).toEqual({ cols: 3, rows: 2 });
    expect(resolveGridLayout(9, DEFAULT_GRID_RULES, { cols: 1, rows: 1 })).toEqual({ cols: 3, rows: 3 });
  });

  it('layoutGridSlots 2x2', () => {
    const slots = layoutGridSlots(0, 0, 100, 80, 2, 2, 4);
    expect(slots).toHaveLength(4);
    expect(slots[0]).toEqual({ x: 0, y: 0, w: 48, h: 38 });
    expect(slots[1].x).toBe(52);
    expect(slots[2].y).toBe(42);
  });
});

describe('viewportNav', () => {
  it('zoomAtCursor keeps cursor point stable', () => {
    expect(clampZoom(0.01)).toBe(0.2);
    expect(clampZoom(10)).toBe(4);
    const next = zoomAtCursor(1, { x: 0, y: 0 }, { x: 100, y: 50 }, 2);
    expect(next.zoom).toBe(2);
    expect(next.pan.x).toBe(100 - 100 * 2);
    expect(next.pan.y).toBe(50 - 50 * 2);
  });

  it('fitZoomForViewport fits page with padding', () => {
    const z = fitZoomForViewport(848, 648, 794, 1123, 48);
    expect(z).toBeLessThanOrEqual(1);
    expect(z).toBeGreaterThan(0.2);
    expect(fitZoomForViewport(10, 10, 794, 1123)).toBe(1);
  });
});

describe('drawHelpers', () => {
  it('normalizeDrawRect handles inverted drag and square constrain', () => {
    expect(normalizeDrawRect(10, 10, 4, 6)).toEqual({ x: 4, y: 6, w: 6, h: 4 });
    const sq = normalizeDrawRect(0, 0, 10, 4, { constrainSquare: true });
    expect(sq.w).toBe(10);
    expect(sq.h).toBe(10);
  });

  it('isClickPlace detects tiny drags', () => {
    expect(isClickPlace({ x: 1, y: 1, w: 1, h: 1 })).toBe(true);
    expect(isClickPlace({ x: 1, y: 1, w: 20, h: 10 })).toBe(false);
  });

  it('isPlaceTool recognizes draw tools', () => {
    expect(isPlaceTool('rect')).toBe(true);
    expect(isPlaceTool('select')).toBe(false);
    expect(isPlaceTool('hand')).toBe(false);
  });

  it('clientToMm accounts for zoom', () => {
    const frame = { left: 100, top: 50 } as DOMRect;
    const { xMm, yMm } = clientToMm(100 + 96, 50 + 96, frame, 1);
    expect(xMm).toBeCloseTo(25.4, 1);
    expect(yMm).toBeCloseTo(25.4, 1);
  });

  it('mmToScreenPx scales layout with zoom and snaps to device pixels', () => {
    expect(mmToScreenPx(25.4, 1)).toBe(96);
    expect(mmToScreenPx(25.4, 2)).toBe(192);
    expect(mmToScreenPx(10, 0.5)).toBe(Math.round(mmToScreenPx(10, 1) / 2));
    // Fractional zoom must not leave subpixel boxes (blurry AA)
    expect(Number.isInteger(mmToScreenPx(10, 0.85))).toBe(true);
    expect(Number.isInteger(mmToScreenPx(25.4, 1.33))).toBe(true);
  });

  it('scaleCssLength scales px lengths and leaves % alone', () => {
    expect(scaleCssLength('11px', 2)).toBe('22px');
    expect(scaleCssLength('1.5px', 2)).toBe('3px');
    expect(scaleCssLength('11px', 0.85)).toBe('9px');
    expect(scaleCssLength('50%', 2)).toBe('50%');
    expect(scaleCssLength(undefined, 2)).toBeUndefined();
  });
});

describe('document model', () => {
  it('createEmptyDocument uses v2 with pages', () => {
    const doc = createEmptyDocument('V2');
    expect(doc.version).toBe(2);
    expect(doc.pages).toHaveLength(1);
    expect(doc.layers[0].pageIndex).toBe(0);
  });

  it('normalizeDocument upgrades v1', () => {
    const v1 = { ...createEmptyDocument('V1'), version: 1 as const, pages: undefined };
    const normalized = normalizeDocument(v1);
    expect(normalized.version).toBe(2);
    expect(normalized.pages).toHaveLength(1);
    expect(normalized.layers[0].pageIndex).toBe(0);
  });
});

describe('page ops', () => {
  it('duplicatePage copies layers and shifts later pages', () => {
    let doc = createEmptyDocument('Pages');
    doc = addPage(doc);
    doc.layers.push({
      id: newId(),
      type: 'text',
      name: 'Título',
      value: 'Hola',
      pageIndex: 0,
      cssVars: { '--width': '40mm', '--height': '10mm' },
    });
    const next = duplicatePage(doc, 0);
    expect(next.pages).toHaveLength(3);
    expect(next.pages?.[1]?.name).toBe('Página 1 copia');
    expect(next.layers.filter((l) => (l.pageIndex ?? 0) === 1 && l.type === 'text')).toHaveLength(1);
    expect(next.layers.filter((l) => (l.pageIndex ?? 0) === 2)).toHaveLength(
      doc.layers.filter((l) => (l.pageIndex ?? 0) === 1).length,
    );
  });

  it('renamePage updates page and frame name', () => {
    const doc = renamePage(createEmptyDocument('Pages'), 0, 'Portada');
    expect(doc.pages?.[0]?.name).toBe('Portada');
    expect(doc.layers.find((l) => l.type === 'frame')?.name).toBe('Portada');
  });

  it('removePage refuses deleting the last page', () => {
    const doc = createEmptyDocument('One');
    expect(removePage(doc, 0)).toBe(doc);
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
      cssVars: {
        '--width': '6mm',
        '--height': '6mm',
        '--translate-x': '10mm',
        '--translate-y': '10mm',
      },
      meta: { key: 'SERVICIO_A' },
    });
    doc.layers.push({
      id: newId(),
      type: 'table',
      name: 'T',
      value: '',
      cssVars: {
        '--width': '100mm',
        '--height': '30mm',
        '--translate-x': '10mm',
        '--translate-y': '20mm',
      },
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

describe('canvas editor P1 helpers', () => {
  it('exposes discoverable shortcuts for design mode', () => {
    expect(CANVAS_SHORTCUTS.length).toBeGreaterThan(8);
    expect(CANVAS_SHORTCUTS.some((s) => s.keys.includes('Ctrl+D'))).toBe(true);
    expect(CANVAS_SHORTCUTS.some((s) => s.action.toLowerCase().includes('campo'))).toBe(true);
  });

  it('locks layers so duplicate skips them', () => {
    const a = createLayer('text', { id: 'a', name: 'A' });
    const b = createLayer('rect', { id: 'b', name: 'B' });
    const locked = setLayerLocked([a, b], 'a', true);
    expect(locked.find((l) => l.id === 'a')?.locked).toBe(true);

    const { layers, newIds } = duplicateLayers(locked, ['a', 'b']);
    expect(newIds).toHaveLength(1);
    expect(layers.filter((l) => l.name.includes('copia'))).toHaveLength(1);
    expect(layers.find((l) => l.name.includes('copia'))?.type).toBe('rect');
  });
});
