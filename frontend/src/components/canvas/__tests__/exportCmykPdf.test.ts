import { describe, expect, it, vi } from 'vitest';
import { api } from '../../../api';
import { exportCanvasPdf } from '../export/exportPdf';
import { createEmptyDocument } from '../types';

vi.mock('../../../api', () => ({
  api: {
    htmlToPdf: vi.fn(),
    canvasExportCmykPdf: vi.fn(),
  },
}));

describe('exportCanvasPdf with CMYK color mode', () => {
  it('calls api.htmlToPdf when colorMode is "rgb" or omitted', async () => {
    const doc = createEmptyDocument('Test RGB');
    (api.htmlToPdf as ReturnType<typeof vi.fn>).mockResolvedValue({
      filename: 'doc.pdf',
      saved_path: '/path/doc.pdf',
    });

    const result = await exportCanvasPdf({
      document: doc,
      contexts: [{}],
      filename: 'doc.pdf',
      colorMode: 'rgb',
    });

    expect(api.htmlToPdf).toHaveBeenCalled();
    expect(api.canvasExportCmykPdf).not.toHaveBeenCalled();
    expect(result.saved_path).toBe('/path/doc.pdf');
  });

  it('calls api.canvasExportCmykPdf when colorMode is "cmyk"', async () => {
    const doc = createEmptyDocument('Test CMYK');
    (api.canvasExportCmykPdf as ReturnType<typeof vi.fn>).mockResolvedValue({
      filename: 'cmyk_doc.pdf',
      saved_path: '/path/cmyk_doc.pdf',
    });

    const result = await exportCanvasPdf({
      document: doc,
      contexts: [{}],
      filename: 'cmyk_doc.pdf',
      colorMode: 'cmyk',
      colorProfile: 'cmyk_iso_coated_v2',
      bleedMm: 3.0,
      showCropMarks: true,
    });

    expect(api.canvasExportCmykPdf).toHaveBeenCalledWith(
      expect.objectContaining({
        color_profile: 'cmyk_iso_coated_v2',
        bleed_mm: 3.0,
        show_crop_marks: true,
        filename: 'cmyk_doc.pdf',
      }),
    );
    expect(api.htmlToPdf).not.toHaveBeenCalled();
    expect(result.saved_path).toBe('/path/cmyk_doc.pdf');
  });
});
