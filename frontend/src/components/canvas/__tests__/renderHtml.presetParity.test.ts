import { describe, expect, it } from 'vitest';
import { renderMultiPageHtml } from '../runtime/planning';
import { renderCanvasHtml, type FillContext } from '../runtime/renderHtml';
import { buildLayerPaintStyle } from '../ops/layerPaint';
import { ensureLinePath } from '../ops/pathGeometry';
import { parseMm, type CanvasDocument } from '../types';

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
    const informe = await import('../presets/informeTecnico');
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
      informe.createInformeTecnicoPreset(),
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
