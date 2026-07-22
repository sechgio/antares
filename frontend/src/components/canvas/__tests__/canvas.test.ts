import { beforeEach, describe, expect, it } from 'vitest';
import { createLayer } from '../constants';
import { DEFAULT_GRID_RULES, layoutGridSlots, rebuildGridSlots, resolveGridLayout, applyGridToImageSlots } from '../ops/gridLayout';
import {
  alignLayers,
  bringToFront,
  distributeLayers,
  duplicateLayers,
  nudgeLayers,
  sendToBack,
  setLayerLocked,
} from '../ops/layerOps';
import {
  assignUniqueLogoSides,
  logoSideHasConflict,
  logoSideOf,
  nextFreeLogoSide,
  withAssignedLogoSide,
} from '../ops/logoSide';
import { addPage, chunkImages, duplicatePage, removePage, renamePage, syncImagesPerPage, templateImagesPerPage } from '../ops/pages';
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
import { createEmptyDocument, mm, newId, normalizeDocument, parseMm } from '../types';
import { CANVAS_SHORTCUTS } from '../shortcuts';
import {
  applyLineStrokeWeight,
  clampStrokeWeight,
  lineHeightMmFromStrokePx,
  lineStrokeWidthPx,
  lineVisualCssVars,
  resetLastStrokeWeight,
  resizeWithAspectLock,
  strokeWeightForNewLine,
} from '../ops/layerStyle';

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

  it('strips placeholder fill and border from logo and field on export', () => {
    const doc = createEmptyDocument('Clean export');
    const field = createLayer('field', {
      id: 'field-nis',
      meta: { key: 'NIS', fallback: '-' },
      cssVars: {
        '--width': '40mm',
        '--height': '8mm',
        '--translate-x': '10mm',
        '--translate-y': '20mm',
        '--color': '#000',
        '--background-color': '#f5f5f5',
        '--border': '1px dashed #bbb',
      },
    });
    const logo = createLayer('logo', {
      id: 'logo-left',
      meta: { side: 'left' },
      cssVars: {
        '--width': '30mm',
        '--height': '12mm',
        '--translate-x': '5mm',
        '--translate-y': '5mm',
        '--background-color': '#eef2ff',
        '--border': '1px dashed #94a3b8',
      },
    });
    const rect = createLayer('rect', {
      id: 'rect-box',
      cssVars: {
        '--width': '20mm',
        '--height': '10mm',
        '--translate-x': '50mm',
        '--translate-y': '50mm',
        '--background-color': '#f8fafc',
        '--border-width': '1px',
        '--border-color': '#cbd5e1',
      },
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

    expect(fieldStyle).toContain('background-color:transparent');
    expect(fieldStyle).not.toMatch(/(?:^|;)\s*border:/);
    expect(fieldStyle).not.toContain('#f5f5f5');
    expect(fieldStyle).not.toContain('dashed');

    expect(logoStyle).toContain('background-color:transparent');
    expect(logoStyle).not.toMatch(/(?:^|;)\s*border:/);
    expect(logoStyle).not.toContain('#eef2ff');
    expect(logoStyle).not.toContain('dashed');

    expect(rectStyle).toMatch(/background-color:/);
    expect(rectStyle).not.toContain('background-color:transparent');
    expect(rectStyle).toMatch(/(?:^|;)\s*border:/);
  });

  it('renders distinct left and right logos when sides differ', () => {
    const doc = createEmptyDocument('Logos');
    doc.layers.push(
      createLayer('logo', {
        meta: { side: 'left' },
        cssVars: {
          '--width': '30mm',
          '--height': '12mm',
          '--translate-x': '5mm',
          '--translate-y': '5mm',
        },
      }),
      createLayer('logo', {
        meta: { side: 'right' },
        cssVars: {
          '--width': '30mm',
          '--height': '12mm',
          '--translate-x': '160mm',
          '--translate-y': '5mm',
        },
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

describe('logoSide', () => {
  it('nextFreeLogoSide prefers left then right', () => {
    expect(nextFreeLogoSide([])).toBe('left');
    const left = createLayer('logo', { meta: { side: 'left' } });
    expect(nextFreeLogoSide([left])).toBe('right');
    const right = createLayer('logo', { meta: { side: 'right' } });
    expect(nextFreeLogoSide([left, right])).toBe('left');
  });

  it('withAssignedLogoSide sets second logo to right', () => {
    const existing = createLayer('logo', { meta: { side: 'left' } });
    const next = withAssignedLogoSide(createLayer('logo'), [existing]);
    expect(logoSideOf(next)).toBe('right');
    expect(next.name).toBe('Logo derecho');
  });

  it('assignUniqueLogoSides flips duplicate logo to free side', () => {
    const left = createLayer('logo', { meta: { side: 'left' } });
    const { layers, newIds } = duplicateLayers([left], [left.id]);
    expect(logoSideOf(layers.find((l) => l.id === newIds[0])!)).toBe('left');
    const fixed = assignUniqueLogoSides(layers, newIds);
    expect(logoSideOf(fixed.find((l) => l.id === newIds[0])!)).toBe('right');
    expect(logoSideHasConflict(fixed, newIds[0])).toBe(false);
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

  it('creates lines with Figma-like stroke weight defaults', () => {
    const line = createLayer('line');
    expect(line.cssVars['--border-width']).toBe('1px');
    expect(line.cssVars['--border-color']).toBe('#000000');
    expect(line.cssVars['--stroke-visible']).toBe('1');
    expect(line.cssVars['--stroke-align']).toBe('center');
    expect(line.cssVars['--background-color']).toBe('transparent');
    expect(line.cssVars['--stroke-start']).toBe('none');
    expect(line.cssVars['--stroke-end']).toBe('none');
    expect(line.meta?.path?.points?.length).toBeGreaterThanOrEqual(2);
    expect(parseMm(line.cssVars['--height'])).toBe(2);
  });
});

describe('line stroke weight', () => {
  beforeEach(() => {
    resetLastStrokeWeight();
  });

  it('applyLineStrokeWeight updates weight on path lines without rewriting bbox height', () => {
    const line = createLayer('line');
    const beforeH = parseMm(line.cssVars['--height']);
    const thick = applyLineStrokeWeight(line, 8);
    expect(thick.cssVars['--border-width']).toBe('8px');
    expect(parseMm(thick.cssVars['--height'])).toBe(beforeH);
    expect(lineStrokeWidthPx(thick)).toBe(8);
  });

  it('accepts fine Figma-like weights (0.1px steps) and clamps to Canva range', () => {
    const line = createLayer('line');
    expect(applyLineStrokeWeight(line, 0.1).cssVars['--border-width']).toBe('0.1px');
    expect(applyLineStrokeWeight(line, 2.5).cssVars['--border-width']).toBe('2.5px');
    expect(applyLineStrokeWeight(line, 0.15).cssVars['--border-width']).toBe('0.15px');
    expect(applyLineStrokeWeight(line, -3).cssVars['--border-width']).toBe('0px');
    expect(applyLineStrokeWeight(line, 250).cssVars['--border-width']).toBe('100px');
    expect(clampStrokeWeight(0.1)).toBe(0.1);
    expect(clampStrokeWeight(100)).toBe(100);
    expect(clampStrokeWeight(101)).toBe(100);
  });

  it('remembers last positive weight for the next line insert', () => {
    expect(strokeWeightForNewLine()).toBe(1);
    applyLineStrokeWeight(createLayer('line'), 4.5);
    expect(strokeWeightForNewLine()).toBe(4.5);
    applyLineStrokeWeight(createLayer('line'), 0);
    expect(strokeWeightForNewLine()).toBe(4.5);
  });

  it('resizeWithAspectLock height on legacy bar-lines maps to stroke weight', () => {
    const line = createLayer('line', {
      cssVars: {
        ...createLayer('line').cssVars,
        '--height': mm(lineHeightMmFromStrokePx(1)),
      },
      meta: {},
    });
    const next = resizeWithAspectLock(line, 'height', lineHeightMmFromStrokePx(4));
    expect(lineStrokeWidthPx(next)).toBeCloseTo(4, 1);
    expect(parseMm(next.cssVars['--height'])).toBeCloseTo(lineHeightMmFromStrokePx(4), 2);
  });

  it('export HTML renders SVG path for lines', () => {
    const doc = createEmptyDocument('Line stroke');
    const line = applyLineStrokeWeight(createLayer('line'), 5);
    doc.layers.push(line);
    const html = renderCanvasHtml(doc, {
      data: {},
      images: [],
      logoLeft: null,
      logoRight: null,
    });
    expect(html).toContain(`data-layer="${line.id}"`);
    expect(html).toMatch(/<path\b/);
    expect(html).toMatch(/stroke-width="/);
    expect(html).not.toMatch(/border:\s*5px/);
  });

  it('export HTML includes arrow marker when stroke-end is arrow', () => {
    const doc = createEmptyDocument('Line arrow');
    const line = createLayer('line', {
      cssVars: {
        ...createLayer('line').cssVars,
        '--stroke-end': 'arrow',
      },
    });
    doc.layers.push(line);
    const html = renderCanvasHtml(doc, {
      data: {},
      images: [],
      logoLeft: null,
      logoRight: null,
    });
    expect(html).toMatch(/<marker\b/);
    expect(html).toMatch(/marker-end=/);
  });

  it('legacy fill-height lines still report a stroke width', () => {
    const legacy = createLayer('line', {
      cssVars: {
        '--width': '80mm',
        '--height': '2mm',
        '--translate-x': '10mm',
        '--translate-y': '10mm',
        '--background-color': '#000000',
      },
      meta: {},
    });
    delete legacy.meta!.path;
    expect(legacy.cssVars['--border-width']).toBeUndefined();
    expect(lineStrokeWidthPx(legacy)).toBeGreaterThan(1);
    const visual = lineVisualCssVars(legacy.cssVars);
    expect(visual['--border-width']).toBe('0px');
    expect(visual['--background-color']).toBe('#000000');
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

  it('duplicateLayers can paste in place with zero offset', () => {
    const source = createLayer('rect');
    source.cssVars['--translate-x'] = '10mm';
    source.cssVars['--translate-y'] = '20mm';
    const { layers: next, newIds } = duplicateLayers([source], [source.id], { offsetMm: 0 });
    const dup = next.find((l) => l.id === newIds[0])!;
    expect(parseMm(dup.cssVars['--translate-x'])).toBe(10);
    expect(parseMm(dup.cssVars['--translate-y'])).toBe(20);
  });

  it('skips locked frames when duplicating', () => {
    const layers = baseLayers();
    const frame = layers[0];
    const { layers: next, newIds } = duplicateLayers(layers, [frame.id]);
    expect(newIds).toHaveLength(0);
    expect(next).toHaveLength(layers.length);
  });

  it('duplicateLayers copies grid children with remapped parentId', () => {
    const grid = createLayer('grid', {
      cssVars: {
        ...createLayer('grid').cssVars,
        '--translate-x': '10mm',
        '--translate-y': '20mm',
      },
    });
    const slotA = createLayer('imageSlot', {
      name: 'Foto 1',
      parentId: grid.id,
      meta: { index: 0 },
      cssVars: {
        ...createLayer('imageSlot').cssVars,
        '--translate-x': '10mm',
        '--translate-y': '20mm',
      },
    });
    const slotB = createLayer('imageSlot', {
      name: 'Foto 2',
      parentId: grid.id,
      meta: { index: 1 },
      cssVars: {
        ...createLayer('imageSlot').cssVars,
        '--translate-x': '60mm',
        '--translate-y': '20mm',
      },
    });
    const layers = [...baseLayers(), grid, slotA, slotB];
    const { layers: next, newIds } = duplicateLayers(layers, [grid.id]);
    expect(newIds).toEqual([expect.any(String)]);
    const dupGrid = next.find((l) => l.id === newIds[0])!;
    expect(dupGrid.type).toBe('grid');
    expect(parseMm(dupGrid.cssVars['--translate-x'])).toBe(15);
    const dupSlots = next.filter((l) => l.parentId === dupGrid.id && l.type === 'imageSlot');
    expect(dupSlots).toHaveLength(2);
    expect(dupSlots.map((s) => s.id)).not.toContain(slotA.id);
    expect(dupSlots.map((s) => s.id)).not.toContain(slotB.id);
    expect(next.filter((l) => l.parentId === grid.id)).toHaveLength(2);
  });

  it('duplicateLayers copies nested group descendants', () => {
    const outer = createLayer('group', { id: 'outer' });
    const inner = createLayer('group', { id: 'inner', parentId: 'outer' });
    const child = createLayer('text', {
      id: 'child',
      parentId: 'inner',
      cssVars: { ...createLayer('text').cssVars, '--translate-x': '0mm', '--translate-y': '0mm' },
    });
    const { layers: next, newIds } = duplicateLayers([outer, inner, child], ['outer']);
    expect(newIds).toEqual([expect.any(String)]);
    const dupOuter = next.find((l) => l.id === newIds[0])!;
    const dupInner = next.find((l) => l.type === 'group' && l.parentId === dupOuter.id);
    expect(dupInner).toBeTruthy();
    const dupChild = next.find((l) => l.type === 'text' && l.parentId === dupInner!.id);
    expect(dupChild).toBeTruthy();
    expect(dupChild!.id).not.toBe('child');
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

  it('alignLayers single uses pageIndex frame', () => {
    const frame0 = createLayer('frame', {
      cssVars: {
        '--translate-x': '0mm',
        '--translate-y': '0mm',
        '--width': '210mm',
        '--height': '297mm',
      },
      pageIndex: 0,
    });
    const frame1 = createLayer('frame', {
      cssVars: {
        '--translate-x': '0mm',
        '--translate-y': '0mm',
        '--width': '210mm',
        '--height': '297mm',
      },
      pageIndex: 1,
    });
    const text = createLayer('text', {
      pageIndex: 1,
      cssVars: {
        '--translate-x': '40mm',
        '--translate-y': '20mm',
        '--width': '40mm',
        '--height': '10mm',
      },
    });
    const aligned = alignLayers([frame0, frame1, text], [text.id], 'left', { pageIndex: 1 });
    expect(parseMm(aligned.find((l) => l.id === text.id)!.cssVars['--translate-x'])).toBe(0);
  });

  it('distributeLayers gaps equalizes spacing between boxes', () => {
    const a = createLayer('rect', {
      cssVars: {
        '--translate-x': '0mm',
        '--translate-y': '0mm',
        '--width': '10mm',
        '--height': '10mm',
      },
    });
    const b = createLayer('rect', {
      cssVars: {
        '--translate-x': '20mm',
        '--translate-y': '0mm',
        '--width': '10mm',
        '--height': '10mm',
      },
    });
    const c = createLayer('rect', {
      cssVars: {
        '--translate-x': '90mm',
        '--translate-y': '0mm',
        '--width': '10mm',
        '--height': '10mm',
      },
    });
    const next = distributeLayers([a, b, c], [a.id, b.id, c.id], 'horizontal', { mode: 'gaps' });
    const bx = parseMm(next.find((l) => l.id === b.id)!.cssVars['--translate-x']);
    // Total span between a.right(10) and c.left(90) = 80; one middle box 10 → gap = 35 each side → b at 45
    expect(bx).toBeCloseTo(45, 5);
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

  it('rebuildGridSlots expands and shrinks child slots to cols×rows', () => {
    const gridId = newId();
    let layers: ReturnType<typeof createLayer>[] = [
      createLayer('grid', {
        id: gridId,
        meta: { cols: 2, rows: 2, gapMm: 2 },
        cssVars: {
          '--width': '100mm',
          '--height': '80mm',
          '--translate-x': '0mm',
          '--translate-y': '0mm',
        },
      }),
    ];
    for (let i = 0; i < 4; i += 1) {
      layers.push(
        createLayer('imageSlot', {
          name: `Foto ${i + 1}`,
          parentId: gridId,
          meta: { index: i },
        }),
      );
    }
    layers = applyGridToImageSlots(layers, gridId);

    const grid = layers.find((l) => l.id === gridId)!;
    layers = layers.map((l) =>
      l.id === gridId ? { ...grid, meta: { ...grid.meta, cols: 3, rows: 2 } } : l,
    );
    const expanded = rebuildGridSlots(layers, gridId);
    const slots = expanded.filter((l) => l.parentId === gridId && l.type === 'imageSlot');
    expect(slots).toHaveLength(6);
    expect(parseMm(slots[2].cssVars['--translate-x'])).toBeGreaterThan(parseMm(slots[0].cssVars['--translate-x']));

    const shrunkGrid = expanded.find((l) => l.id === gridId)!;
    const shrunk = rebuildGridSlots(
      expanded.map((l) =>
        l.id === gridId ? { ...shrunkGrid, meta: { ...shrunkGrid.meta, cols: 2, rows: 2 } } : l,
      ),
      gridId,
    );
    expect(shrunk.filter((l) => l.parentId === gridId && l.type === 'imageSlot')).toHaveLength(4);
  });

  it('applyGridToImageSlots without imageCount uses designed meta cols×rows', () => {
    const gridId = newId();
    let layers = [
      createLayer('grid', {
        id: gridId,
        meta: { cols: 3, rows: 2, gapMm: 2, rules: DEFAULT_GRID_RULES },
        cssVars: {
          '--width': '100mm',
          '--height': '80mm',
          '--translate-x': '0mm',
          '--translate-y': '0mm',
        },
      }),
    ];
    for (let i = 0; i < 6; i += 1) {
      layers.push(createLayer('imageSlot', { parentId: gridId, meta: { index: i } }));
    }
    layers = applyGridToImageSlots(layers, gridId);
    const slots = layers.filter((l) => l.parentId === gridId);
    // 3 columns → third slot shares the first row (same Y as first, larger X)
    expect(parseMm(slots[0].cssVars['--translate-y'])).toBe(parseMm(slots[2].cssVars['--translate-y']));
    expect(parseMm(slots[2].cssVars['--translate-x'])).toBeGreaterThan(parseMm(slots[1].cssVars['--translate-x']));
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

  it('templateImagesPerPage follows page-0 image slots', () => {
    const doc = createEmptyDocument('Slots');
    doc.settings = { imagesPerPage: 4 };
    for (let i = 0; i < 6; i += 1) {
      doc.layers.push({
        id: newId(),
        type: 'imageSlot',
        name: `Foto ${i + 1}`,
        value: '',
        pageIndex: 0,
        cssVars: { '--width': '40mm', '--height': '40mm' },
        meta: { index: i },
      });
    }
    expect(templateImagesPerPage(doc)).toBe(6);
    expect(syncImagesPerPage(doc).settings?.imagesPerPage).toBe(6);
  });

  it('chunkImages splits by per-page capacity', () => {
    expect(chunkImages(['a', 'b', 'c', 'd', 'e'], 2)).toEqual([['a', 'b'], ['c', 'd'], ['e']]);
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
