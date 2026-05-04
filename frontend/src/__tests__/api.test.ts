// frontend/src/__tests__/api.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { api } from '../api';

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

  it('should handle IPC errors', async () => {
    mockInvoke.mockRejectedValue(new Error('Backend no disponible'));
    
    await expect(api.version()).rejects.toThrow('Backend no disponible');
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

  it('should call HTML PDF renderer with correct method', async () => {
    mockInvoke.mockResolvedValue({ pdf_base64: 'JVBERi0=', filename: 'reporte.pdf' });

    const result = await api.htmlToPdf({ html: '<html></html>', filename: 'reporte.pdf' });

    expect(mockInvoke).toHaveBeenCalledWith('html_to_pdf', { html: '<html></html>', filename: 'reporte.pdf' });
    expect(result.filename).toBe('reporte.pdf');
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
