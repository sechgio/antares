import { beforeEach, describe, expect, it } from 'vitest';
import { createLayer } from '../constants';
import {
  DEFAULT_GRID_RULES,
  layoutGridSlots,
  rebuildGridSlots,
  resolveGridLayout,
  applyGridToImageSlots,
  matchGridSlotsToSourceSize,
} from '../ops/gridLayout';
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
import { addPage, chunkImages, duplicatePage, removePage, renamePage, renderMultiPageHtml, syncImagesPerPage, templateImagesPerPage } from '../ops/pages';
import {
  clientToMm,
  isClickPlace,
  isPlaceTool,
  mmToScreenPx,
  normalizeDrawRect,
  scaleCssLength,
} from '../ops/drawHelpers';
import { clampZoom, fitZoomForViewport, MAX_ZOOM, MIN_ZOOM, nextZoomPreset, pinchViewport, wheelPanDelta, zoomAtCursor } from '../ops/viewportNav';
import { filterVisibleLayers, visiblePageRectMm } from '../ops/viewportCulling';
import { applyAnchoredResize, parseResizeAnchor, resizeLayerAnchored, RESIZE_ANCHORS } from '../ops/resizeConstraints';
import { clipPathForLayerType, isShapeTool, isSquareConstrainTool } from '../ops/shapePaths';
import { buildRowData, matchesRecordId } from '../runtime/excel';
import { mergeCanvasHtmlDocuments, renderCanvasHtml, type FillContext } from '../runtime/renderHtml';
import { buildLayerPaintStyle } from '../ops/layerPaint';
import { ensureLinePath } from '../ops/pathGeometry';
import { createEmptyDocument, mm, newId, normalizeDocument, parseMm } from '../types';
import { CANVAS_SHORTCUTS } from '../shortcuts';
import {
  addBoxShadow,
  applyLineStrokeWeight,
  cssVarsToStyleParts,
  formatBoxShadows,
  parseBlendMode,
  parseBoxShadows,
  removeBoxShadowAt,
  updateBoxShadowAt,
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

  it('matches LayerNode text box model (padding, justify, pre-wrap, line-height)', () => {
    const doc = createEmptyDocument('Text parity');
    doc.layers.push({
      id: 'text-center',
      type: 'text',
      name: 'T',
      value: 'Linea 1\nLinea 2',
      cssVars: {
        '--width': '40mm',
        '--height': '16mm',
        '--translate-x': '10mm',
        '--translate-y': '20mm',
        '--color': '#000',
        '--text-align': 'center',
      },
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

  it('keeps field and logo layer paint in export (WYSIWYG)', () => {
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

    expect(fieldStyle.toLowerCase()).toContain('#f5f5f5');
    expect(fieldStyle).toMatch(/(?:^|;)\s*border:/);
    expect(fieldStyle).toContain('dashed');

    expect(logoStyle.toLowerCase()).toContain('#eef2ff');
    expect(logoStyle).toMatch(/(?:^|;)\s*border:/);
    expect(logoStyle).toContain('dashed');

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
        cssVars: {
          '--width': '50mm',
          '--height': '40mm',
          '--translate-x': '10mm',
          '--translate-y': '40mm',
          '--background-color': '#f1f5f9',
          '--border': '1px dashed #94a3b8',
          '--object-fit': 'cover',
        },
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
    // 4 images would resolve to 2×2 under DEFAULT_GRID_RULES — must NOT relayout.
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
    // First slot stays at designed position (applyGrid without imageCount).
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
        cssVars: {
          '--width': '40mm',
          '--height': '8mm',
          '--translate-x': '10mm',
          '--translate-y': '20mm',
        },
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
        cssVars: {
          '--width': '40mm',
          '--height': '8mm',
          '--translate-x': '10mm',
          '--translate-y': '20mm',
          '--background-color': '#fefefe',
          '--border-width': '1px',
          '--border-color': '#888888',
          '--border-style': 'dotted',
        },
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
        cssVars: {
          '--width': '30mm',
          '--height': '12mm',
          '--translate-x': '5mm',
          '--translate-y': '5mm',
          '--object-fit': 'cover',
        },
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
        cssVars: {
          '--width': '6mm',
          '--height': '6mm',
          '--translate-x': '10mm',
          '--translate-y': '10mm',
          '--border-width': '2px',
          '--border-color': '#0e8fd6',
          '--color': '#0e8fd6',
          '--font-size': '12pt',
        },
      }),
      createLayer('signature', {
        id: 'sig-1',
        value: 'Ana Ruiz',
        cssVars: {
          '--width': '60mm',
          '--height': '20mm',
          '--translate-x': '10mm',
          '--translate-y': '30mm',
          '--color': '#334155',
          '--font-size': '9pt',
        },
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
        cssVars: {
          '--width': '40mm',
          '--height': '20mm',
          '--translate-x': '10mm',
          '--translate-y': '10mm',
          '--background-color': '#000',
          '--border-radius': '8px',
        },
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

  it('layoutGridSlots respects unequal col/row tracks', () => {
    const slots = layoutGridSlots(0, 0, 100, 80, 2, 2, 0, {
      cols: [3, 1],
      rows: [1, 1],
    });
    expect(slots[0]!.w).toBeCloseTo(75, 5);
    expect(slots[1]!.w).toBeCloseTo(25, 5);
    expect(slots[1]!.x).toBeCloseTo(75, 5);
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

  it('rebuildGridSlots on empty grid does not steal other grid slots', () => {
    const emptyId = newId();
    const otherId = newId();
    const otherSlotId = newId();
    const layers = [
      createLayer('grid', {
        id: emptyId,
        meta: { cols: 2, rows: 2, gapMm: 2 },
        cssVars: {
          '--width': '100mm',
          '--height': '80mm',
          '--translate-x': '0mm',
          '--translate-y': '0mm',
        },
      }),
      createLayer('grid', {
        id: otherId,
        meta: { cols: 1, rows: 1, gapMm: 2 },
        cssVars: {
          '--width': '40mm',
          '--height': '40mm',
          '--translate-x': '120mm',
          '--translate-y': '0mm',
        },
      }),
      createLayer('imageSlot', {
        id: otherSlotId,
        name: 'Foto other',
        parentId: otherId,
        meta: { index: 0 },
        cssVars: {
          '--width': '40mm',
          '--height': '40mm',
          '--translate-x': '120mm',
          '--translate-y': '0mm',
        },
      }),
    ];
    const next = rebuildGridSlots(layers, emptyId);
    expect(next.find((l) => l.id === otherSlotId)?.parentId).toBe(otherId);
    const emptySlots = next.filter((l) => l.parentId === emptyId && l.type === 'imageSlot');
    expect(emptySlots).toHaveLength(4);
    expect(emptySlots.every((s) => s.id !== otherSlotId)).toBe(true);
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

  it('matchGridSlotsToSourceSize equalizes all cells to the source slot size', () => {
    const gridId = newId();
    let layers = [
      createLayer('grid', {
        id: gridId,
        meta: { cols: 2, rows: 2, gapMm: 2 },
        cssVars: {
          '--width': '100mm',
          '--height': '80mm',
          '--translate-x': '10mm',
          '--translate-y': '5mm',
        },
      }),
      ...[0, 1, 2, 3].map((i) =>
        createLayer('imageSlot', { id: `slot-${i}`, parentId: gridId, meta: { index: i } }),
      ),
    ];
    layers = applyGridToImageSlots(layers, gridId);
    layers = layers.map((l) =>
      l.id === 'slot-0'
        ? {
            ...l,
            cssVars: {
              ...l.cssVars,
              '--width': '70mm',
              '--height': '50mm',
            },
          }
        : l,
    );
    const sourceBefore = layers.find((l) => l.id === 'slot-0')!;
    const sourceW = parseMm(sourceBefore.cssVars['--width']);
    const sourceH = parseMm(sourceBefore.cssVars['--height']);
    expect(sourceW).toBeCloseTo(70, 5);
    expect(sourceH).toBeCloseTo(50, 5);

    const next = matchGridSlotsToSourceSize(layers, 'slot-0');
    const grid = next.find((l) => l.id === gridId)!;
    const slots = next.filter((l) => l.parentId === gridId && l.type === 'imageSlot');
    expect(slots).toHaveLength(4);
    for (const s of slots) {
      expect(parseMm(s.cssVars['--width'])).toBeCloseTo(sourceW, 5);
      expect(parseMm(s.cssVars['--height'])).toBeCloseTo(sourceH, 5);
    }
    // Larger cells still grow the grid to fit (gap preserved).
    expect(parseMm(grid.cssVars['--width'])).toBeCloseTo(sourceW * 2 + 2, 5);
    expect(parseMm(grid.cssVars['--height'])).toBeCloseTo(sourceH * 2 + 2, 5);
    expect(parseMm(grid.cssVars['--translate-x'])).toBeCloseTo(10, 5);
    expect(parseMm(grid.cssVars['--translate-y'])).toBeCloseTo(5, 5);
    expect(grid.meta?.gapMm).toBe(2);
    expect(grid.meta?.colTracks).toEqual([1, 1]);
    expect(grid.meta?.rowTracks).toEqual([1, 1]);
  });

  it('matchGridSlotsToSourceSize does not shrink the grid frame for smaller cells', () => {
    const gridId = newId();
    let layers = [
      createLayer('grid', {
        id: gridId,
        meta: { cols: 2, rows: 2, gapMm: 2 },
        cssVars: {
          '--width': '100mm',
          '--height': '80mm',
          '--translate-x': '10mm',
          '--translate-y': '5mm',
        },
      }),
      ...[0, 1, 2, 3].map((i) =>
        createLayer('imageSlot', { id: `slot-${i}`, parentId: gridId, meta: { index: i } }),
      ),
    ];
    layers = applyGridToImageSlots(layers, gridId);
    layers = layers.map((l) =>
      l.id === 'slot-0'
        ? {
            ...l,
            cssVars: {
              ...l.cssVars,
              '--width': '30mm',
              '--height': '20mm',
            },
          }
        : l,
    );

    const next = matchGridSlotsToSourceSize(layers, 'slot-0');
    const grid = next.find((l) => l.id === gridId)!;
    const slots = next.filter((l) => l.parentId === gridId && l.type === 'imageSlot');
    expect(slots).toHaveLength(4);
    for (const s of slots) {
      expect(parseMm(s.cssVars['--width'])).toBeCloseTo(30, 5);
      expect(parseMm(s.cssVars['--height'])).toBeCloseTo(20, 5);
    }
    // Outer frame stays put; gap between cells stays 2mm; content is centered.
    expect(parseMm(grid.cssVars['--width'])).toBeCloseTo(100, 5);
    expect(parseMm(grid.cssVars['--height'])).toBeCloseTo(80, 5);
    expect(parseMm(grid.cssVars['--translate-x'])).toBeCloseTo(10, 5);
    expect(parseMm(grid.cssVars['--translate-y'])).toBeCloseTo(5, 5);
    expect(grid.meta?.gapMm).toBe(2);
    // content = 30*2+2=62 by 20*2+2=42 → pad (100-62)/2=19, (80-42)/2=19
    const slot0 = slots.find((s) => s.meta?.index === 0)!;
    const slot1 = slots.find((s) => s.meta?.index === 1)!;
    expect(parseMm(slot0.cssVars['--translate-x'])).toBeCloseTo(10 + 19, 5);
    expect(parseMm(slot0.cssVars['--translate-y'])).toBeCloseTo(5 + 19, 5);
    expect(parseMm(slot1.cssVars['--translate-x'])).toBeCloseTo(10 + 19 + 30 + 2, 5);
    expect(parseMm(slot1.cssVars['--translate-y'])).toBeCloseTo(5 + 19, 5);
  });

  it('matchGridSlotsToSourceSize is a no-op for non-grid slots', () => {
    const lone = createLayer('imageSlot', { id: 'lone' });
    const rect = createLayer('rect', { id: 'r1' });
    const layers = [lone, rect];
    expect(matchGridSlotsToSourceSize(layers, 'lone')).toBe(layers);
    expect(matchGridSlotsToSourceSize(layers, 'r1')).toBe(layers);
    expect(matchGridSlotsToSourceSize(layers, 'missing')).toBe(layers);
  });
});

describe('viewportNav', () => {
  it('zoomAtCursor keeps cursor point stable', () => {
    expect(clampZoom(0.001)).toBe(MIN_ZOOM);
    expect(clampZoom(100000)).toBe(MAX_ZOOM);
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

  it('normalizeDocument repairs incomplete v2 and fills missing updatedAt with now', () => {
    const before = Date.now();
    const incomplete = {
      ...createEmptyDocument('V2'),
      version: 2 as const,
      pages: undefined,
      guides: undefined,
      styles: undefined,
      settings: undefined,
      updatedAt: undefined,
      layers: [
        {
          id: newId(),
          type: 'text' as const,
          name: 'T',
          value: 'x',
          cssVars: { '--width': '10mm', '--height': '5mm' },
        },
      ],
    };
    const normalized = normalizeDocument(incomplete);
    expect(normalized.version).toBe(2);
    expect(normalized.pages).toHaveLength(1);
    expect(normalized.guides).toEqual([]);
    expect(normalized.styles).toEqual([]);
    expect(normalized.settings).toEqual({});
    expect(normalized.layers[0].pageIndex).toBe(0);
    expect(normalized.updatedAt).toBeTruthy();
    expect(Date.parse(normalized.updatedAt!)).toBeGreaterThanOrEqual(before - 1000);
    expect(Date.parse(normalized.updatedAt!)).not.toBe(0);
  });
});

describe('page ops', () => {
  it('duplicatePage remaps parentId within the copied page tree', () => {
    let doc = createEmptyDocument('Pages');
    const groupId = newId();
    const childId = newId();
    doc.layers.push(
      {
        id: groupId,
        type: 'group',
        name: 'Grupo',
        value: '',
        pageIndex: 0,
        cssVars: { '--width': '80mm', '--height': '40mm' },
      },
      {
        id: childId,
        type: 'text',
        name: 'Hijo',
        value: 'x',
        pageIndex: 0,
        parentId: groupId,
        cssVars: { '--width': '40mm', '--height': '10mm' },
      },
    );
    const next = duplicatePage(doc, 0);
    const copiedChild = next.layers.find(
      (l) => (l.pageIndex ?? 0) === 1 && l.type === 'text' && l.name === 'Hijo',
    );
    const copiedGroup = next.layers.find(
      (l) => (l.pageIndex ?? 0) === 1 && l.type === 'group' && l.name === 'Grupo',
    );
    expect(copiedGroup).toBeDefined();
    expect(copiedChild).toBeDefined();
    expect(copiedChild!.parentId).toBe(copiedGroup!.id);
    expect(copiedChild!.parentId).not.toBe(groupId);
  });

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

describe('viewportNav wide zoom range', () => {
  it('supports the wide 0.02x-256x zoom range', () => {
    expect(MIN_ZOOM).toBe(0.02);
    expect(MAX_ZOOM).toBe(256);
    expect(clampZoom(0.001)).toBe(0.02);
    expect(clampZoom(999)).toBe(256);
  });

  it('nextZoomPreset traverses the extended preset stops', () => {
    expect(nextZoomPreset(1, 'in')).toBe(1.5);
    expect(nextZoomPreset(64, 'in')).toBe(128);
    expect(nextZoomPreset(256, 'in')).toBe(256);
    expect(nextZoomPreset(0.02, 'out')).toBe(0.02);
  });

  it('wheelPanDelta pans horizontally on Shift+wheel', () => {
    expect(wheelPanDelta(0, 120, false)).toEqual({ x: 0, y: 120 });
    expect(wheelPanDelta(0, 120, true)).toEqual({ x: 120, y: 0 });
    expect(wheelPanDelta(30, 120, true)).toEqual({ x: 30, y: 120 });
  });

  it('pinchViewport scales and tracks the fingers midpoint', () => {
    const start = { zoom: 1, pan: { x: 0, y: 0 } };
    const zoomed = pinchViewport(start, { x: 0, y: 0 }, { x: 0, y: 0 }, 2);
    expect(zoomed.zoom).toBe(2);
    expect(zoomed.pan).toEqual({ x: 0, y: 0 });

    const moved = pinchViewport(start, { x: 100, y: 50 }, { x: 140, y: 80 }, 1.5);
    expect(moved.zoom).toBe(1.5);
    expect(moved.pan.x).toBeCloseTo(140 - 100 * 1.5, 6);
    expect(moved.pan.y).toBeCloseTo(80 - 50 * 1.5, 6);

    expect(pinchViewport(start, { x: 0, y: 0 }, { x: 0, y: 0 }, 1000).zoom).toBe(MAX_ZOOM);
    expect(pinchViewport(start, { x: 0, y: 0 }, { x: 0, y: 0 }, 0)).toBe(start);
  });
});

describe('viewportCulling', () => {
  it('visiblePageRectMm maps the viewport to a page mm region', () => {
    const rect = visiblePageRectMm(848, 648, { x: 0, y: 0 }, 1, 794, 1123, 0);
    expect(rect).not.toBeNull();
    expect(rect!.x + rect!.w / 2).toBeCloseTo(105, 0);
    expect(rect!.y + rect!.h / 2).toBeCloseTo(148.5, 0);
    expect(visiblePageRectMm(0, 0, { x: 0, y: 0 }, 1, 794, 1123)).toBeNull();
  });

  it('filterVisibleLayers keeps intersecting and forced layers only', () => {
    const near = createLayer('rect', {
      cssVars: { '--width': '20mm', '--height': '20mm', '--translate-x': '90mm', '--translate-y': '140mm' },
    });
    const far = createLayer('rect', {
      cssVars: { '--width': '20mm', '--height': '20mm', '--translate-x': '500mm', '--translate-y': '900mm' },
    });
    const view = { x: 0, y: 0, w: 210, h: 297 };
    expect(filterVisibleLayers([near, far], view).map((l) => l.id)).toEqual([near.id]);
    expect(filterVisibleLayers([near, far], view, new Set([far.id]))).toHaveLength(2);
    expect(filterVisibleLayers([near, far], null)).toHaveLength(2);
  });

  it('filterVisibleLayers uses rotated AABB for culling', () => {
    // Local box is y=0..10; 90° rotation expands AABB to y≈-5..15.
    // View only overlaps the tall AABB, not the flat local box.
    const rotated = createLayer('rect', {
      cssVars: {
        '--width': '20mm',
        '--height': '10mm',
        '--translate-x': '0mm',
        '--translate-y': '0mm',
        '--rotate': '90deg',
      },
    });
    const view = { x: 6, y: 12, w: 4, h: 4 };
    expect(filterVisibleLayers([rotated], view).map((l) => l.id)).toEqual([rotated.id]);
  });
});

describe('resizeConstraints', () => {
  const base = () =>
    createLayer('rect', {
      cssVars: {
        '--width': '100mm',
        '--height': '50mm',
        '--translate-x': '10mm',
        '--translate-y': '20mm',
      },
    });

  it('defaults to the top-left anchor (legacy behavior)', () => {
    expect(parseResizeAnchor(undefined)).toBe('tl');
    expect(parseResizeAnchor('bogus')).toBe('tl');
    expect(RESIZE_ANCHORS).toHaveLength(9);
    const next = applyAnchoredResize(base(), { w: 200 }, 'tl');
    expect(next.cssVars['--translate-x']).toBe('10mm');
    expect(next.cssVars['--translate-y']).toBe('20mm');
  });

  it('keeps the pinned edge, corner or center fixed', () => {
    const br = applyAnchoredResize(base(), { w: 200, h: 100 }, 'br');
    expect(parseMm(br.cssVars['--translate-x'])).toBe(-90);
    expect(parseMm(br.cssVars['--translate-y'])).toBe(-30);
    const cc = applyAnchoredResize(base(), { w: 200, h: 100 }, 'cc');
    expect(parseMm(cc.cssVars['--translate-x'])).toBe(-40);
    expect(parseMm(cc.cssVars['--translate-y'])).toBe(-5);
    const tr = applyAnchoredResize(base(), { w: 50 }, 'tr');
    expect(parseMm(tr.cssVars['--translate-x'])).toBe(60);
    expect(parseMm(tr.cssVars['--translate-y'])).toBe(20);
  });

  it('resizeLayerAnchored combines aspect lock and anchor', () => {
    const layer = base();
    layer.cssVars['--aspect-locked'] = '1';
    layer.cssVars['--resize-anchor'] = 'br';
    const next = resizeLayerAnchored(layer, 'width', 200);
    expect(parseMm(next.cssVars['--width'])).toBe(200);
    expect(parseMm(next.cssVars['--height'])).toBe(100);
    expect(parseMm(next.cssVars['--translate-x'])).toBe(-90);
    expect(parseMm(next.cssVars['--translate-y'])).toBe(-30);
  });
});

describe('multi-shadow and blend modes', () => {
  it('parses and formats multiple shadows (rgba commas safe)', () => {
    const two = '0px 4px 8px rgba(0,0,0,0.25), 2px 2px 4px rgba(255,0,0,0.5)';
    const shadows = parseBoxShadows(two);
    expect(shadows).toHaveLength(2);
    expect(shadows[0]).toMatchObject({ x: 0, y: 4, blur: 8, opacity: 25 });
    expect(shadows[1]).toMatchObject({ x: 2, y: 2, blur: 4 });
    expect(formatBoxShadows(shadows)).toBe(two);
    expect(parseBoxShadows('none')).toEqual([]);
    expect(parseBoxShadows(undefined)).toEqual([]);
    expect(formatBoxShadows([])).toBe('none');
  });

  it('adds, updates and removes shadows by index', () => {
    const one = addBoxShadow(undefined);
    expect(parseBoxShadows(one)).toHaveLength(1);
    const two = addBoxShadow(one, { color: '#FF0000', x: 2, y: 2, blur: 4, opacity: 50 });
    expect(parseBoxShadows(two)).toHaveLength(2);
    const updated = updateBoxShadowAt(two, 1, { y: 6 });
    expect(parseBoxShadows(updated)[1]).toMatchObject({ x: 2, y: 6 });
    expect(updateBoxShadowAt(two, 9, { y: 6 })).toBe(two);
    const removed = removeBoxShadowAt(two, 0);
    const remaining = parseBoxShadows(removed);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].color).toBe('#FF0000');
    expect(removeBoxShadowAt(removed, 0)).toBe('none');
  });

  it('blend modes parse and render as mix-blend-mode', () => {
    const layer = createLayer('rect');
    expect(parseBlendMode(layer.cssVars)).toBe('normal');
    layer.cssVars['--blend-mode'] = 'overlay';
    expect(parseBlendMode(layer.cssVars)).toBe('overlay');
    layer.cssVars['--blend-mode'] = 'nonsense';
    expect(parseBlendMode(layer.cssVars)).toBe('normal');
    const css = cssVarsToStyleParts({ ...layer.cssVars, '--blend-mode': 'multiply' }).join(';');
    expect(css).toContain('mix-blend-mode:multiply');
    const normalCss = cssVarsToStyleParts({ ...layer.cssVars, '--blend-mode': 'normal' }).join(';');
    expect(normalCss).not.toContain('mix-blend-mode');
  });
});

describe('new clip-path shapes', () => {
  it('creates diamond, hexagon and pentagon layers with clip paths', () => {
    for (const type of ['diamond', 'hexagon', 'pentagon'] as const) {
      const layer = createLayer(type);
      expect(layer.type).toBe(type);
      expect(clipPathForLayerType(type)).toContain('polygon(');
      expect(isShapeTool(type)).toBe(true);
      expect(isSquareConstrainTool(type)).toBe(true);
    }
    expect(clipPathForLayerType('rect')).toBeUndefined();
    expect(isSquareConstrainTool('line')).toBe(false);
  });
});

describe('renderMultiPageHtml photo metadata chunking', () => {
  it('chunks imageMeta in sync with images so captions match photo on page 2+', () => {
    const doc: CanvasDocument = {
      version: 2,
      id: 'doc-1',
      name: 'Test Doc',
      page: { widthMm: 210, heightMm: 297 },
      pages: [{ id: 'p1', name: 'Page 1' }],
      layers: [
        {
          id: 'slot-1',
          type: 'imageSlot',
          name: 'Foto 1',
          value: '',
          pageIndex: 0,
          cssVars: { '--translate-x': '10mm', '--translate-y': '10mm', '--width': '50mm', '--height': '50mm' },
          meta: { index: 0, showDate: true, showCoords: true, showFilename: true },
        },
      ],
      fields: [],
    };

    const ctx: FillContext = {
      data: {},
      images: ['img0.jpg', 'img1.jpg'],
      logoLeft: null,
      logoRight: null,
      imageMeta: [
        { date: '2026-01-01', coords: '-12.0, -77.0', name: 'foto_1.jpg' },
        { date: '2026-02-02', coords: '-14.0, -75.0', name: 'foto_2.jpg' },
      ],
    };

    const html = renderMultiPageHtml(doc, ctx, { imagesPerPage: 1 });
    expect(html).toContain('img0.jpg');
    expect(html).toContain('img1.jpg');
    expect(html).toContain('2026-01-01');
    expect(html).toContain('2026-02-02');
  });
});

describe('preset WYSIWYG parity (design vs renderHtml)', () => {
  const MM = 96 / 25.4;
  const toPx = (mmVal: number) => Math.round(mmVal * MM);

  function styleOf(html: string, layerId: string): string {
    return html.match(new RegExp(`data-layer="${layerId}"[^>]*style="([^"]*)"`))?.[1] ?? '';
  }

  async function loadAllPresets() {
    const panels = await import('../presets/panels');
    const reservorios = await import('../presets/reservorios');
    const etapas = await import('../presets/etapas');
    const certificates = await import('../presets/certificates');
    return [
      panels.createReportPreset(),
      panels.createEmergenciasPreset(),
      panels.createPanelAvisoCortePreset(),
      panels.createPanelVolanteoPreset(),
      panels.createEvidenciaVolanteoPreset(),
      panels.createMaquinaBaldePreset(),
      panels.createVolanMaqBaldeSjlPreset(),
      panels.createAniegosChorrillosPreset(),
      reservorios.createFormatReservoriosPreset(),
      reservorios.createPanelReservoriosPreset(),
      reservorios.createReservoriosLuriganchoV2Preset(),
      reservorios.createReservoriosLuriganchoSgioPreset(),
      reservorios.createReservoriosVillaSunassPreset(),
      etapas.createFormatEtapasPreset(),
      certificates.createCertLugoPreset(),
      certificates.createCertSjlBlancoPreset(),
      certificates.createCertSjlGuardaminoPreset(),
    ];
  }

  it('every preset layer has matching box geometry and paint in export', async () => {
    const ctx: FillContext = { data: {}, images: [], logoLeft: null, logoRight: null };
    for (const doc of await loadAllPresets()) {
      const html = renderCanvasHtml(doc, ctx, { forScreen: true });
      const layers = doc.layers.filter((l) => l.visible !== false && l.type !== 'frame');
      for (const layer of layers) {
        const style = styleOf(html, layer.id);
        expect(style, `${doc.name} · ${layer.name || layer.type}`).not.toBe('');

        const ref = layer.type === 'line' ? ensureLinePath(layer) : layer;
        const x = toPx(parseMm(ref.cssVars['--translate-x']));
        const y = toPx(parseMm(ref.cssVars['--translate-y']));
        const w = toPx(parseMm(ref.cssVars['--width'], 10));
        const h = toPx(parseMm(ref.cssVars['--height'], 10));
        expect(style, `${doc.name} · ${layer.id} left`).toContain(`left:${x}px`);
        expect(style, `${doc.name} · ${layer.id} top`).toContain(`top:${y}px`);
        expect(style, `${doc.name} · ${layer.id} width`).toContain(`width:${w}px`);
        expect(style, `${doc.name} · ${layer.id} height`).toContain(`height:${h}px`);

        if (layer.type !== 'line') {
          const paint = buildLayerPaintStyle(layer.cssVars, { scale: 1 });
          if (paint.fontSize) {
            expect(style, `${doc.name} · ${layer.id} font-size`).toContain(`font-size:${paint.fontSize}`);
          }
          if (paint.color) {
            expect(style.toLowerCase(), `${doc.name} · ${layer.id} color`).toContain(
              paint.color.toLowerCase(),
            );
          }
        }
      }
    }
  });

  it('grid layers show design chrome label in export', async () => {
    const { createReportPreset } = await import('../presets/panels');
    const doc = createReportPreset();
    const grid = doc.layers.find((l) => l.type === 'grid')!;
    const html = renderCanvasHtml(
      doc,
      { data: {}, images: [], logoLeft: null, logoRight: null },
      { forScreen: true },
    );
    expect(html).toContain(`data-layer="${grid.id}"`);
    expect(html).toMatch(new RegExp(`data-layer="${grid.id}"[^>]*>.*?Grid 3×2`, 's'));
  });
});

