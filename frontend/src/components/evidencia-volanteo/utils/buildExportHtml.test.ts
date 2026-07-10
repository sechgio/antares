import { describe, expect, it } from 'vitest';
import { DEFAULT_TITLE } from '../constants';
import { PAGE_MARGIN_MM, PHOTO_GAP_CM, PHOTO_HEIGHT_CM, PHOTO_TABLE_COLS, TABLE_WIDTH_CM, TITLE_FONT_PT } from '../layout';
import type { LocalImage } from '../types';
import { createDefaultRange } from './cuadranteRanges';
import { buildExportHtml, imageExportKey } from './buildExportHtml';

function fakeImage(index: number): LocalImage {
  const file = new File(['x'], `foto-${index}.jpg`, { type: 'image/jpeg' });
  return { file, objectUrl: `blob:${index}` };
}

describe('buildExportHtml', () => {
  it('genera HTML con los mismos estilos que la vista previa', () => {
    const html = buildExportHtml(
      DEFAULT_TITLE,
      [createDefaultRange(1, 1, 'AV EL SOL')],
      [],
      {},
      null,
      null,
    );

    expect(html).toContain(`font-size:${TITLE_FONT_PT}pt`);
    expect(html).toContain(`height:${PHOTO_HEIGHT_CM}cm`);
    expect(html).toContain('text-decoration:underline');
    expect(html).toContain('AV EL SOL');
    expect(html).toContain('EVIDENCIAS FOTOGRÁFICAS DEL VOLANTEO');
    expect(html).toContain(`margin: ${PAGE_MARGIN_MM}mm`);
    expect(html).toContain(`width: ${TABLE_WIDTH_CM}cm`);
    expect(html).toContain('ev-sheet-page');
    expect(html).toContain('overflow: visible');
    expect(html).not.toContain('overflow: hidden');
    expect(html).toContain(`width:${PHOTO_GAP_CM}cm`);
    expect(html).toMatch(new RegExp(`colspan=["']${PHOTO_TABLE_COLS}["']`, 'i'));
    expect(html).toContain('overflow-wrap:anywhere');
    expect(html).toContain('word-break:break-word');
  });

  it('mantiene el cuadrante largo dentro de la celda central', () => {
    const longCuadrante = `QWSADD${'D'.repeat(80)}`;
    const html = buildExportHtml(
      DEFAULT_TITLE,
      [createDefaultRange(1, 1, longCuadrante)],
      [],
      {},
      null,
      null,
    );
    expect(html).toContain(longCuadrante);
    expect(html).toContain('overflow-wrap:anywhere');
    expect(html).toContain('word-break:break-word');
    expect(html).toMatch(/max-width:\s*11(?:\.0)?cm/);
  });

  it('agrupa 6 imágenes por hoja A4', () => {
    const images = Array.from({ length: 12 }, (_, i) => fakeImage(i + 1));
    const uris = Object.fromEntries(
      images.map((img, index) => [imageExportKey(index, img.file.name), `data:image/jpeg;base64,abc${index}`]),
    );
    const html = buildExportHtml(DEFAULT_TITLE, [createDefaultRange(1, 2, 'ZONA')], images, uris, null, null);
    const sheetCount = (html.match(/preview-paper-scope bg-white text-black ev-sheet-page/g) ?? []).length;
    expect(sheetCount).toBe(2);
  });

  it('permite etiqueta personalizada y ocultarla', () => {
    const withCustom = buildExportHtml(
      DEFAULT_TITLE,
      [createDefaultRange(1, 1, 'AV EL SOL')],
      [],
      {},
      null,
      null,
      'ZONA INTERVENIDA:',
      true,
    );
    expect(withCustom).toContain('ZONA INTERVENIDA:');
    expect(withCustom).not.toContain('CUADRANTE AFECTADO:');

    const hidden = buildExportHtml(
      DEFAULT_TITLE,
      [createDefaultRange(1, 1, 'AV EL SOL')],
      [],
      {},
      null,
      null,
      'CUADRANTE AFECTADO:',
      false,
    );
    expect(hidden).not.toContain('CUADRANTE AFECTADO:');
    expect(hidden).toContain('AV EL SOL');
  });
});