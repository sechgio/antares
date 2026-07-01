import { describe, expect, it } from 'vitest';
import { DEFAULT_TITLE } from '../constants';
import { PAGE_MARGIN_MM, TABLE_HEIGHT_CM, TITLE_FONT_PT, PHOTO_HEIGHT_CM } from '../layout';
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
    expect(html).toContain(`height: ${TABLE_HEIGHT_CM}cm`);
    expect(html).toContain('ev-sheet-page');
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
});