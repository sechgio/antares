import { describe, it, expect, vi, beforeEach } from 'vitest';
import { api, AntaresAPIError } from '../api';

// Mock electronAPI
const mockInvoke = vi.fn();
const mockOnNotify = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  window.electronAPI = {
    invoke: mockInvoke,
    onNotify: mockOnNotify,
  } as any;
});

describe('API Client', () => {
  it('should call version endpoint', async () => {
    mockInvoke.mockResolvedValue({ version: '0.3.6' });
    
    const result = await api.version();
    
    expect(mockInvoke).toHaveBeenCalledWith('version', undefined);
    expect(result.version).toBe('0.3.6');
  });

  it('should propagate IPC errors without frontend retries', async () => {
    // Retry logic lives in the Electron main process (ipc-router._callBackend),
    // so the frontend issues a single invoke and surfaces whatever it returns.
    mockInvoke.mockRejectedValue(new Error('Backend no disponible'));

    await expect(api.version()).rejects.toThrow('Backend no disponible');
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  }, 30000);

  it('should preserve code and category from structured IPC errors', async () => {
    mockInvoke.mockRejectedValue({
      message: 'Archivo bloqueado',
      code: -32002,
      category: 'RESOURCE_LOCKED',
      details: { path: 'C:\\out.jpg' },
    });

    try {
      await api.version();
      expect.unreachable('expected AntaresAPIError');
    } catch (err) {
      expect(err).toBeInstanceOf(AntaresAPIError);
      const apiErr = err as AntaresAPIError;
      expect(apiErr.message).toBe('Archivo bloqueado');
      expect(apiErr.code).toBe(-32002);
      expect(apiErr.category).toBe('RESOURCE_LOCKED');
      expect(apiErr.isResourceLockedError()).toBe(true);
      expect(apiErr.details).toEqual({ path: 'C:\\out.jpg' });
    }
  });

  it('should validate response types', async () => {
    mockInvoke.mockResolvedValue({ formats: ['JPEG', 'PNG'] });
    
    const result = await api.formats();
    
    expect(result.formats).toBeInstanceOf(Array);
    expect(result.formats).toContain('JPEG');
  });

  it('should call dialogFiles with correct method', async () => {
    mockInvoke.mockResolvedValue({ paths: ['/path/file.jpg'] });
    
    const result = await api.dialogFiles();
    
    expect(mockInvoke).toHaveBeenCalledWith('dialog_files', undefined);
    expect(result.paths).toContain('/path/file.jpg');
  });

  it('should forward raw HTML to the Electron PDF renderer (B-10: sanitization lives in Electron)', async () => {
    mockInvoke.mockResolvedValue({ pdf_base64: 'JVBERi0=', filename: 'reporte.pdf' });

    const rawHtml = '<html><head><style>.x{background:url(file:///etc/passwd)}</style></head><body><script>alert(1)</script></body></html>';
    const result = await api.htmlToPdf({
      html: rawHtml,
      filename: 'reporte.pdf',
    });

    expect(mockInvoke).toHaveBeenCalledWith('html_to_pdf', {
      html: rawHtml,
      filename: 'reporte.pdf',
    });
    expect(result.filename).toBe('reporte.pdf');
  });

  it('should pass an output path to HTML PDF renderer for direct saves', async () => {
    mockInvoke.mockResolvedValue({ saved_path: 'C:\\tmp\\reporte.pdf', filename: 'reporte.pdf' });

    const result = await api.htmlToPdf({
      html: '<html><body>PDF</body></html>',
      filename: 'reporte.pdf',
      outputPath: 'C:\\tmp\\reporte.pdf',
    });

    expect(mockInvoke).toHaveBeenCalledWith('html_to_pdf', {
      html: '<html><body>PDF</body></html>',
      filename: 'reporte.pdf',
      outputPath: 'C:\\tmp\\reporte.pdf',
    });
    expect(result.saved_path).toBe('C:\\tmp\\reporte.pdf');
  });

  it('should pass output path to formatos generator for direct saves', async () => {
    mockInvoke.mockResolvedValue({ saved_path: 'C:\\tmp\\formato.pdf', filename: 'formato.pdf' });

    const result = await api.formatosGenerate({
      format_id: 'template-d',
      desde: 1,
      hasta: 500,
      output_path: 'C:\\tmp\\formato.pdf',
    });

    expect(mockInvoke).toHaveBeenCalledWith('formatos_generate', {
      format_id: 'template-d',
      desde: 1,
      hasta: 500,
      output_path: 'C:\\tmp\\formato.pdf',
    });
    expect(result.saved_path).toBe('C:\\tmp\\formato.pdf');
  });

  it('should call technical reports list with correct method', async () => {
    mockInvoke.mockResolvedValue({ reports: [] });

    const result = await api.technicalReportsList({ summary: true });

    expect(mockInvoke).toHaveBeenCalledWith('technical_reports_list', { summary: true });
    expect(result.reports).toEqual([]);
  });

  it('should call technical reports import with base64 payload', async () => {
    mockInvoke.mockResolvedValue({ imported_count: 1, deleted_count: 0, total_rows_in_file: 1, success: true, message: 'ok' });

    const result = await api.technicalReportsImportFile({ filename: 'datos.csv', content_b64: 'YQ==' });

    expect(mockInvoke).toHaveBeenCalledWith('technical_reports_import_file', { filename: 'datos.csv', content_b64: 'YQ==' });
    expect(result.imported_count).toBe(1);
  });

  it('should call technical reports HTML renderer', async () => {
    mockInvoke.mockResolvedValue({ html: '<html></html>', filename: 'informe_RPT-0001.pdf' });

    const result = await api.technicalReportsRenderHtml({ id: 'RPT-0001' });

    expect(mockInvoke).toHaveBeenCalledWith('technical_reports_render_html', { id: 'RPT-0001' });
    expect(result.filename).toBe('informe_RPT-0001.pdf');
  });

  it('should clear the IPC timeout timer on success (no leak)', async () => {
    // Fix: el timer del race de timeout debe limpiarse cuando el invoke
    // resuelve, para no gotear closures en sesiones largas. Antes del fix
    // clearTimeout nunca se llamaba en éxito.
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    mockInvoke.mockResolvedValue({ version: '1' });

    await api.version();

    expect(clearTimeoutSpy).toHaveBeenCalled();
    clearTimeoutSpy.mockRestore();
  });

  it('should call startProcess with correct params', async () => {
    mockInvoke.mockResolvedValue({ started: true });
    const body = {
      files: ['/path/file.jpg'],
      destino: '/output',
      formato: 'JPEG',
      calidad: 95,
      resize_ancho: null,
      resize_alto: null,
      keep_exif: false,
      usar_rename: true,
      patron: '{codigo}{ext}',
      secuencia: 1,
      use_filename_seq: true,
    };
    
    const result = await api.startProcess(body);
    
    expect(mockInvoke).toHaveBeenCalledWith('process_start', body);
    expect(result.started).toBe(true);
  });
});
