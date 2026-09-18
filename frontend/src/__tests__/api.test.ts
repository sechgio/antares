import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  api,
  AntaresAPIError,
  apiRetryAfterMs,
  restartBackend,
  _resetBackendReadyForTests,
  _resetCanvasHistoryTransportForTests,
} from '../api';

const mockInvoke = vi.fn();
const mockOnNotify = vi.fn();
const mockReportRendererError = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  _resetCanvasHistoryTransportForTests();
  window.electronAPI = {
    invoke: mockInvoke,
    onNotify: mockOnNotify,
    reportRendererError: mockReportRendererError,
  } as any;
});

it('sends only the changed Canvas history suffix after a successful full save', async () => {
  const firstStep = { type: 'diff' as const, undoDiff: {}, redoDiff: {} };
  const secondStep = { type: 'diff' as const, undoDiff: { name: 'A' }, redoDiff: { name: 'B' } };
  mockInvoke
    .mockResolvedValueOnce({ success: true, digest: 'digest-1' })
    .mockResolvedValueOnce({ success: true, digest: 'digest-2' });

  await api.canvasSaveHistory('doc-a', [firstStep], []);
  await api.canvasSaveHistory('doc-a', [firstStep, secondStep], []);

  expect(mockInvoke).toHaveBeenNthCalledWith(1, 'canvas_save_history', {
    id: 'doc-a',
    past: [firstStep],
    future: [],
    include_digest: true,
  });
  expect(mockInvoke).toHaveBeenNthCalledWith(2, 'canvas_save_history', {
    id: 'doc-a',
    past_prefix: 1,
    past: [secondStep],
    future_prefix: 0,
    future: [],
    base_digest: 'digest-1',
  });
});

it('falls back to a full Canvas history save when the persisted base changed', async () => {
  const firstStep = { type: 'diff' as const, undoDiff: {}, redoDiff: {} };
  const secondStep = { type: 'diff' as const, undoDiff: {}, redoDiff: {} };
  mockInvoke
    .mockResolvedValueOnce({ success: true, digest: 'digest-1' })
    .mockRejectedValueOnce(new Error('history base changed'))
    .mockResolvedValueOnce({ success: true, digest: 'digest-2' });

  await api.canvasSaveHistory('doc-a', [firstStep], []);
  await api.canvasSaveHistory('doc-a', [firstStep, secondStep], []);

  expect(mockInvoke).toHaveBeenLastCalledWith('canvas_save_history', {
    id: 'doc-a',
    past: [firstStep, secondStep],
    future: [],
    include_digest: true,
  });
});

describe('API Client', () => {
  it('should call version endpoint', async () => {
    mockInvoke.mockResolvedValue({ version: '0.3.6' });
    
    const result = await api.version();
    
    expect(mockInvoke).toHaveBeenCalledWith('version', undefined);
    expect(result.version).toBe('0.3.6');
  });

  it('should propagate IPC errors without frontend retries', async () => {
    mockInvoke.mockRejectedValue(new Error('Backend no disponible'));

    await expect(api.version()).rejects.toThrow('Backend no disponible');
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockReportRendererError).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'api_error',
        view: 'api:version',
        name: 'AntaresAPIError[INTERNAL_ERROR]',
        message: 'Backend no disponible',
      }),
    );
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
      expect(apiErr.details).toEqual({ path: 'C:\\out.jpg' });
      expect(mockReportRendererError).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'api_error',
          view: 'api:version',
          name: 'AntaresAPIError[RESOURCE_LOCKED]',
          message: 'Archivo bloqueado',
        }),
      );
    }
  });

  it('should decode ANTARES_IPC_ERROR payloads wrapped by Electron invoke', async () => {
    const payload = {
      message: 'Template not found: report.html',
      code: -32000,
      category: 'INTERNAL_ERROR',
    };
    mockInvoke.mockRejectedValue(
      new Error(`Error invoking remote method 'ipc-call': Error: ANTARES_IPC_ERROR:${JSON.stringify(payload)}`),
    );

    try {
      await api.templatesList();
      expect.unreachable('expected AntaresAPIError');
    } catch (err) {
      expect(err).toBeInstanceOf(AntaresAPIError);
      const apiErr = err as AntaresAPIError;
      expect(apiErr.message).toBe('Template not found: report.html');
      expect(apiErr.code).toBe(-32000);
      expect(apiErr.category).toBe('INTERNAL_ERROR');
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
    mockInvoke.mockResolvedValue({ items: [] });

    const result = await api.technicalReportsList({ summary: true });

    expect(mockInvoke).toHaveBeenCalledWith('technical_reports_list', { summary: true });
    expect(result.items).toEqual([]);
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

  it('should hydrate spreadsheet_parse spill through paged reads and release it', async () => {
    mockInvoke.mockImplementation(async (method: string, params?: Record<string, unknown>) => {
      if (method === 'spreadsheet_parse') {
        return {
          workbookName: 'big.xlsx',
          sheets: [],
          warnings: ['spilled'],
          result_file_token: 'antares-read_spill1',
          sheet_meta: [{ name: 'Hoja1', rowCount: 2 }],
        };
      }
      if (method === 'spreadsheet_get_rows') {
        return {
          name: 'Hoja1',
          rows: [['A'], ['1']],
          offset: params?.offset,
          limit: params?.limit,
          total: 2,
          has_more: false,
        };
      }
      if (method === 'file_token_cleanup') return { cleaned: true };
      throw new Error(`unexpected method ${method}`);
    });

    const result = await api.spreadsheetParse({ file_token: 'antares-read_file1', format_hint: 'xlsx' });

    expect(mockInvoke).toHaveBeenCalledWith(
      'spreadsheet_parse',
      expect.objectContaining({ file_token: 'antares-read_file1', format_hint: 'xlsx' }),
    );
    expect(mockInvoke).toHaveBeenCalledWith('spreadsheet_get_rows', {
      result_file_token: 'antares-read_spill1',
      sheet_index: 0,
      offset: 0,
      limit: 5000,
    });
    expect(mockInvoke).toHaveBeenCalledWith('file_token_cleanup', { token: 'antares-read_spill1' });
    expect(result.sheets[0]?.rows).toEqual([['A'], ['1']]);
    expect(result.warnings).toContain('spilled');
    expect('result_file_token' in result).toBe(false);
  });

  it('should use a timeout budget that outlives Electron main startup wait', async () => {
    _resetBackendReadyForTests();
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    mockInvoke.mockResolvedValue({ version: '1' });

    await api.version();

    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 100_000);
    setTimeoutSpy.mockRestore();
  });

  it('should use extended timeout budget for long-running methods', async () => {
    _resetBackendReadyForTests();
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    mockInvoke.mockResolvedValue({ success: true, count: 1 });

    await api.informesV2RenderConsolidatedHtml({ report_ids: ['1'] });

    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 370_000);
    setTimeoutSpy.mockRestore();
  });

  it('drops the startup buffer once the backend answered a backend method', async () => {
    _resetBackendReadyForTests();
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    mockInvoke.mockResolvedValue({ version: '1' });

    await api.version();
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 100_000);

    setTimeoutSpy.mockClear();
    await api.version();
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 40_000);
    expect(setTimeoutSpy).not.toHaveBeenCalledWith(expect.any(Function), 100_000);
    setTimeoutSpy.mockRestore();
  });

  it('should retry once after a pre-execution retryable rejection', async () => {
    mockInvoke
      .mockRejectedValueOnce({
        message: 'Memoria baja',
        code: -32003,
        category: 'MEMORY_PRESSURE',
        details: { retry_after_ms: 1 },
      })
      .mockResolvedValueOnce({ version: '0.3.6' });

    const result = await api.version();

    expect(mockInvoke).toHaveBeenCalledTimes(2);
    expect(result.version).toBe('0.3.6');
  });

  it('should not retry non-retryable errors', async () => {
    mockInvoke.mockRejectedValue({
      message: 'boom',
      code: -32000,
      category: 'INTERNAL_ERROR',
    });

    await expect(api.version()).rejects.toThrow('boom');
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it('should propagate the error when the retry also fails', async () => {
    mockInvoke.mockRejectedValue({
      message: 'Backend ocupado',
      code: -32005,
      category: 'CAPACITY_EXCEEDED',
      details: { retryable: true, retry_after_ms: 1 },
    });

    await expect(api.version()).rejects.toMatchObject({ category: 'CAPACITY_EXCEEDED' });
    expect(mockInvoke).toHaveBeenCalledTimes(2);
  });

  it('reports error to telemetry when restartBackend fails', async () => {
    const mockBackendRestart = vi.fn().mockRejectedValue(new Error('Process crash on restart'));
    window.electronAPI = {
      ...window.electronAPI!,
      backendRestart: mockBackendRestart,
    };

    await expect(restartBackend()).rejects.toThrow('Process crash on restart');
    expect(mockReportRendererError).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'api_error',
        view: 'api:backend_restart',
        message: 'Process crash on restart',
      }),
    );
  });
});

describe('apiRetryAfterMs', () => {
  it('honors retry_after_ms for memory pressure', () => {
    expect(
      apiRetryAfterMs({ category: 'MEMORY_PRESSURE', details: { retry_after_ms: 2500 } }),
    ).toBe(2500);
  });

  it('returns a default delay for retryable capacity errors', () => {
    expect(
      apiRetryAfterMs({ category: 'CAPACITY_EXCEEDED', details: { retryable: true } }),
    ).toBe(2000);
  });

  it('caps the server-provided delay', () => {
    expect(
      apiRetryAfterMs({ category: 'MEMORY_PRESSURE', details: { retry_after_ms: 999_999 } }),
    ).toBe(60_000);
  });

  it('returns null for non-retryable errors', () => {
    expect(apiRetryAfterMs(new AntaresAPIError('x'))).toBeNull();
    expect(apiRetryAfterMs(new Error('x'))).toBeNull();
    expect(apiRetryAfterMs('x')).toBeNull();
    expect(apiRetryAfterMs({ category: 'VALIDATION_ERROR' })).toBeNull();
  });
});
