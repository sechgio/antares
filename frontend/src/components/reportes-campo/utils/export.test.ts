import { beforeEach, describe, expect, it, vi } from 'vitest';
import { REPORT_TYPES, chunkArray, getDefaultHeader, getReportConfig } from '../constants';
import { buildReportPdfHtml, exportReportPdf } from './export';
import type { PhotoFile } from '../types';

const mockApi = vi.hoisted(() => ({
  dialogSave: vi.fn(),
  htmlToPdf: vi.fn(),
}));

vi.mock('../../../api', () => ({
  api: mockApi,
}));

describe('reportes-campo report model', () => {
  it('builds one report page per group of four photos', () => {
    expect(chunkArray([1, 2, 3, 4, 5], 4)).toEqual([[1, 2, 3, 4], [5]]);
  });

  it('uses the configured title as the default header title', () => {
    const config = getReportConfig('maquina-balde');

    expect(getDefaultHeader(config).titulo).toBe('Máquina de Balde');
  });

  it('does not depend on HTTP endpoints for desktop export', () => {
    for (const reportType of REPORT_TYPES) {
      expect(reportType).not.toHaveProperty('endpoint');
    }
  });

  it('builds printable A4 HTML instead of rasterizing the live DOM', () => {
    const config = getReportConfig('panel-fotografico');
    const photo = new File(['image'], 'foto.jpg', { type: 'image/jpeg' });
    const html = buildReportPdfHtml({
      config,
      header: getDefaultHeader(config),
      photos: [{ id: '1', file: photo, previewUrl: 'antares-local-image:photo-0' }],
      logoLeft: null,
      logoRight: null,
    });

    expect(html).toContain('@page { size: A4 portrait; margin: 0; }');
    expect(html).toContain('class="report-page"');
    expect(html).toContain('antares-local-image:photo-0');
  });

  it('exports through the native Electron HTML-to-PDF renderer', async () => {
    const config = getReportConfig('panel-fotografico');
    const photo = new File(['image'], 'foto.jpg', { type: 'image/jpeg' });
    Object.defineProperty(photo, 'path', { value: 'C:\\tmp\\foto.jpg' });
    const photos: PhotoFile[] = [{ id: '1', file: photo, previewUrl: 'blob:preview' }];

    mockApi.dialogSave.mockResolvedValue({ paths: ['C:\\tmp\\panel.pdf'] });
    mockApi.htmlToPdf.mockResolvedValue({ filename: 'panel.pdf', saved_path: 'C:\\tmp\\panel.pdf' });

    const result = await exportReportPdf(config, getDefaultHeader(config), photos, null, null);

    expect(mockApi.dialogSave).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Guardar PDF',
      defaultPath: config.filename,
    }));
    expect(mockApi.htmlToPdf).toHaveBeenCalledWith(expect.objectContaining({
      filename: config.filename,
      outputPath: 'C:\\tmp\\panel.pdf',
      localImagePaths: { 'antares-local-image:photo-0': 'C:\\tmp\\foto.jpg' },
    }));
    expect(result).toEqual({ filename: 'panel.pdf', savedPath: 'C:\\tmp\\panel.pdf' });
  });

  it('does not render when the save dialog is cancelled', async () => {
    const config = getReportConfig('panel-fotografico');
    const photo = new File(['image'], 'foto.jpg', { type: 'image/jpeg' });
    const photos: PhotoFile[] = [{ id: '1', file: photo, previewUrl: 'blob:preview' }];

    mockApi.dialogSave.mockResolvedValue({ paths: [] });

    await expect(exportReportPdf(config, getDefaultHeader(config), photos, null, null))
      .resolves.toEqual({ cancelled: true });
    expect(mockApi.htmlToPdf).not.toHaveBeenCalled();
  });
});

beforeEach(() => {
  mockApi.dialogSave.mockReset();
  mockApi.htmlToPdf.mockReset();
});
