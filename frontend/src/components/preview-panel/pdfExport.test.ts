import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildLocalImageToken,
  buildPdfFilename,
  imageToPdfSource,
  mergeHtmlDocuments,
  selectRowsForPdfExport,
} from './pdfExport';

const stageFileForIpc = vi.hoisted(() => vi.fn());

vi.mock('../../utils/stageFile', () => ({ stageFileForIpc }));

const file = (name: string) => ({ name } as File);

describe('preview panel PDF export helpers', () => {
  beforeEach(() => {
    // jsdom exposes Image but never completes blob URL decoding. Make the
    // browser/no-staging fallback deterministic so the test reaches the
    // File/arrayBuffer path that it is asserting.
    vi.stubGlobal('Image', undefined);
  });

  afterEach(() => {
    stageFileForIpc.mockReset();
    vi.unstubAllGlobals();
  });

  it('selects only the current row for single export', () => {
    const rows = [{ OT: 'A1' }, { OT: 'B2' }];
    const selected = selectRowsForPdfExport({
      data: rows,
      selectedIndex: '1',
      exportScope: 'single',
      idColumn: 'OT',
      requiresImages: true,
      images: [file('B2_1.jpg'), file('A1_1.jpg')],
    });

    expect(selected).toHaveLength(1);
    expect(selected[0].row).toBe(rows[1]);
    expect(selected[0].images.map(img => img.name)).toEqual(['B2_1.jpg']);
  });

  it('selects all rows with matching images for consolidated export', () => {
    const rows = [{ OT: 'A1' }, { OT: 'B2' }, { OT: 'C3' }];
    const selected = selectRowsForPdfExport({
      data: rows,
      selectedIndex: '',
      exportScope: 'all',
      idColumn: 'OT',
      requiresImages: true,
      images: [file('B2_1.jpg'), file('A1_2.jpg'), file('A1_1.jpg')],
    });

    expect(selected.map(item => item.idValue)).toEqual(['A1', 'B2']);
    expect(selected[0].images.map(img => img.name)).toEqual(['A1_1.jpg', 'A1_2.jpg']);
  });

  it('keeps all rows when the selected template does not require images', () => {
    const rows = [{ OT: 'A1' }, { OT: 'B2' }];
    const selected = selectRowsForPdfExport({
      data: rows,
      selectedIndex: '',
      exportScope: 'all',
      idColumn: 'OT',
      requiresImages: false,
      images: [],
    });

    expect(selected.map(item => item.idValue)).toEqual(['A1', 'B2']);
  });

  it('builds distinct names for single and consolidated PDFs', () => {
    expect(buildPdfFilename({
      exportScope: 'single',
      templateName: 'panel-volanteo.html',
      idValue: 'OT 123/45',
      date: new Date('2026-05-02T12:00:00'),
    })).toBe('panel-volanteo_OT_123_45.pdf');

    expect(buildPdfFilename({
      exportScope: 'all',
      templateName: 'panel-volanteo.html',
      idValue: '',
      date: new Date('2026-05-02T12:00:00'),
    })).toBe('panel-volanteo_consolidado_2026-05-02.pdf');
  });

  it('merges multiple rendered HTML documents into one printable document', () => {
    const html = mergeHtmlDocuments([
      '<!doctype html><html><head><style>.page{color:red}</style></head><body><div class="page">Uno</div></body></html>',
      '<!doctype html><html><head><style>.page{color:blue}</style></head><body><div class="page">Dos</div></body></html>',
    ]);

    expect(html).toContain('<style>.page{color:red}</style>');
    expect(html).toContain('<style>.page{color:blue}</style>');
    expect(html).toContain('<div class="page">Uno</div>');
    expect(html).toContain('<div class="page">Dos</div>');
    expect(html).toContain('@page { size: A4 portrait; margin: 0; }');
  });

  it('uses a local image token for high quality export after staging', async () => {
    stageFileForIpc.mockResolvedValue('antares-read_preview');
    const file = new File(['image'], 'foto.jpg', { type: 'image/jpeg' });
    const source = await imageToPdfSource(
      file,
      'high',
      'row-1-img-0',
    );

    expect(source.src).toBe(buildLocalImageToken('row-1-img-0'));
    expect(source.token).toBe(source.src);
    expect(source.fileToken).toBe('antares-read_preview');
  });

  it('uses a local image token for max quality export after staging', async () => {
    stageFileForIpc.mockResolvedValue('antares-read_preview');
    const file = new File(['image'], 'foto.jpg', { type: 'image/jpeg' });
    const source = await imageToPdfSource(
      file,
      'max',
      'row-1-img-0',
    );

    expect(source.src).toBe(buildLocalImageToken('row-1-img-0'));
    expect(source.token).toBe(source.src);
    expect(source.fileToken).toBe('antares-read_preview');
  });

  it('uses original file data URL for max quality without Electron path', async () => {
    const content = 'original-image-bytes';
    const file = new File([content], 'foto.jpg', { type: 'image/jpeg' });
    stageFileForIpc.mockResolvedValue(null);
    const source = await imageToPdfSource(file, 'max', 'row-1-img-0');

    expect(source.src).toMatch(/^data:image\/jpeg;base64,/);
    expect(source.fileToken).toBeUndefined();
    expect(source.token).toBeUndefined();
  });
});
