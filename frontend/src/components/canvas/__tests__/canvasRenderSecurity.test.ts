import { describe, expect, it } from 'vitest';
import { renderCanvasHtml } from '../runtime/renderHtml';
import { createEmptyDocument } from '../types';
import { boxCss } from './fixtures';

describe('renderHtml seguridad: URLs de imagen bloqueadas', () => {
  function docWithImageValue(value: string) {
    const doc = createEmptyDocument('Seguridad');
    doc.layers.push({
      id: 'img-sec',
      type: 'image',
      name: 'I',
      value,
      cssVars: boxCss('10mm', '10mm', '40mm', '30mm'),
    });
    return doc;
  }

  function imgSrcOf(html: string, layerId: string): string | null {
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    const layerEl = parsed.querySelector(`[data-layer="${layerId}"]`);
    return layerEl?.querySelector('img')?.getAttribute('src') ?? null;
  }

  it('blanka file:, javascript:, data:text/html, data:image/svg+xml y http(s) remotos en image layers', () => {
    for (const evil of [
      'file:///C:/Users/x/secreto.png',
      'javascript:alert(1)',
      'data:text/html;base64,PHNjcmlwdD4=',
      'data:image/svg+xml;base64,PHN2Zz4=',
      'https://cdn.example.com/tracker.png',
      'http://example.com/x.png',
    ]) {
      const html = renderCanvasHtml(docWithImageValue(evil), {
        data: {},
        images: [],
        logoLeft: null,
        logoRight: null,
      });
      expect(html).not.toContain(evil);
      expect(imgSrcOf(html, 'img-sec')).toBe('');
    }
  });

  it('preserva data: raster, blob: y tokens antares-local-image:', () => {
    const raster = 'data:image/png;base64,AAAA';
    expect(
      imgSrcOf(
        renderCanvasHtml(docWithImageValue(raster), {
          data: {},
          images: [],
          logoLeft: null,
          logoRight: null,
        }),
        'img-sec',
      ),
    ).toBe(raster);

    const blob = 'blob:https://app/img-1';
    expect(
      imgSrcOf(
        renderCanvasHtml(docWithImageValue(blob), {
          data: {},
          images: [],
          logoLeft: null,
          logoRight: null,
        }),
        'img-sec',
      ),
    ).toBe(blob);

    const token = 'antares-local-image:row-0-img-0';
    expect(
      imgSrcOf(
        renderCanvasHtml(docWithImageValue(token), {
          data: {},
          images: [],
          logoLeft: null,
          logoRight: null,
        }),
        'img-sec',
      ),
    ).toBe(token);
  });

  it('blanka URLs remotas en imageSlot y logo del contexto', () => {
    const doc = createEmptyDocument('Slots');
    doc.layers.push({
      id: 'slot-sec',
      type: 'imageSlot',
      name: 'F1',
      value: '',
      cssVars: boxCss('10mm', '10mm', '40mm', '30mm'),
      meta: { index: 0 },
    });
    doc.layers.push({
      id: 'logo-sec',
      type: 'logo',
      name: 'L',
      value: '',
      cssVars: boxCss('5mm', '5mm', '20mm', '10mm'),
      meta: { side: 'left' },
    });
    const html = renderCanvasHtml(doc, {
      data: {},
      images: ['https://evil.example.com/pixel.png'],
      logoLeft: 'javascript:alert(1)',
      logoRight: null,
    });
    expect(html).not.toContain('evil.example.com');
    expect(html).not.toContain('javascript:alert');
  });
});

describe('renderHtml seguridad: escape de atributos style', () => {
  it('un cssVar con comillas no rompe el atributo style ni inyecta atributos', () => {
    const doc = createEmptyDocument('Escape');
    doc.layers.push({
      id: 'img-evil',
      type: 'image',
      name: 'I',
      value: 'data:image/png;base64,AAA',
      cssVars: boxCss('10mm', '10mm', '40mm', '30mm', {
        '--object-position': '50% 50%" onerror="alert(1)',
      }),
    });
    const html = renderCanvasHtml(doc, {
      data: {},
      images: [],
      logoLeft: null,
      logoRight: null,
    });
    expect(html).not.toContain('onerror="');
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    const img = parsed.querySelector('img');
    expect(img).not.toBeNull();
    expect(img!.hasAttribute('onerror')).toBe(false);
    expect(img!.getAttribute('style')).toContain('object-position:50% 50%" onerror="alert(1)');
  });

  it('documentos benignos parsean al mismo CSS tras el escape (paridad visual)', () => {
    const doc = createEmptyDocument('Paridad');
    doc.layers.push({
      id: 'txt-benign',
      type: 'text',
      name: 'T',
      value: 'Hola',
      cssVars: boxCss('10mm', '20mm', '40mm', '8mm', {
        '--color': '#000',
        '--font-family': "'Segoe UI', 'Helvetica Neue', Arial, sans-serif",
      }),
    });
    const html = renderCanvasHtml(doc, {
      data: {},
      images: [],
      logoLeft: null,
      logoRight: null,
    });
    // El HTML serializado no contiene comillas literales dentro de los atributos style.
    const boxAttr = html.match(/data-layer="txt-benign"[^>]*style="([^"]*)"/)?.[1] ?? '';
    expect(boxAttr).toContain('&#39;');
    expect(boxAttr).not.toContain("'");

    const parsed = new DOMParser().parseFromString(html, 'text/html');
    const layerEl = parsed.querySelector('[data-layer="txt-benign"]') as HTMLElement;
    expect(layerEl.getAttribute('style')).toContain("font-family:'Segoe UI', 'Helvetica Neue', Arial, sans-serif");
    const span = layerEl.querySelector('span') as HTMLElement;
    expect(span.getAttribute('style')).toContain('white-space:pre-wrap');
  });

  it('un valor de datos con markup queda escapado en campos y no crea nodos', () => {
    const doc = createEmptyDocument('Datos');
    doc.layers.push({
      id: 'field-evil',
      type: 'field',
      name: 'NIS',
      value: '',
      cssVars: boxCss('10mm', '10mm', '40mm', '8mm'),
      meta: { key: 'NIS', fallback: '-' },
    });
    const html = renderCanvasHtml(doc, {
      data: { NIS: '<img src=x onerror=alert(1)>' },
      images: [],
      logoLeft: null,
      logoRight: null,
    });
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x');
  });
});
