import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { downloadBase64Blob } from './pdfAssets';
import { renderAndDeliverDocument } from './deliverRenderedDocument';

vi.mock('../api', () => ({ api: { dialogSave: vi.fn() } }));
vi.mock('./pdfAssets', () => ({ downloadBase64Blob: vi.fn() }));

const payload = { title: 'Informe' };
const options = { defaultName: 'informe.pdf', format: 'pdf' as const };

beforeEach(() => vi.resetAllMocks());
const originalBridge = window.electronAPI;
afterEach(() => { window.electronAPI = originalBridge; });

describe('renderAndDeliverDocument', () => {
  it.each(['', 'generado.pdf'])('renders only to the native save target (returned filename: %j)', async (filename) => {
    window.electronAPI = { ...originalBridge, invoke: vi.fn() };
    vi.mocked(api.dialogSave).mockResolvedValue({ paths: ['C:/salidas/informe.pdf'] });
    const render = vi.fn().mockResolvedValue({ content_base64: '', filename });

    await expect(renderAndDeliverDocument(payload, render, options)).resolves.toEqual({
      filename: filename || 'C:/salidas/informe.pdf',
    });

    expect(api.dialogSave).toHaveBeenCalledWith({
      title: 'Guardar documento',
      defaultPath: 'informe.pdf',
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    expect(render).toHaveBeenCalledExactlyOnceWith(payload, 'C:/salidas/informe.pdf');
    expect(downloadBase64Blob).not.toHaveBeenCalled();
  });

  it('does not render or download when the native save dialog is cancelled', async () => {
    window.electronAPI = { ...originalBridge, invoke: vi.fn() };
    vi.mocked(api.dialogSave).mockResolvedValue({ paths: [] });
    const render = vi.fn();

    await expect(renderAndDeliverDocument(payload, render, options)).resolves.toEqual({ filename: '' });

    expect(render).not.toHaveBeenCalled();
    expect(downloadBase64Blob).not.toHaveBeenCalled();
  });

  it.each(['dialog', 'render'])('propagates native %s failures without a browser fallback', async (stage) => {
    window.electronAPI = { ...originalBridge, invoke: vi.fn() };
    const failure = new Error('No se pudo guardar el documento');
    vi.mocked(api.dialogSave).mockResolvedValue({ paths: ['C:/salidas/informe.pdf'] });
    const render = vi.fn().mockRejectedValue(failure);
    if (stage === 'dialog') vi.mocked(api.dialogSave).mockRejectedValue(failure);

    await expect(renderAndDeliverDocument(payload, render, options)).rejects.toBe(failure);

    expect(render).toHaveBeenCalledTimes(stage === 'dialog' ? 0 : 1);
    expect(downloadBase64Blob).not.toHaveBeenCalled();
  });

  it.each([
    ['pdf', 'application/pdf'],
    ['docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ] as const)('downloads browser %s exports with the correct content type', async (format, mimeType) => {
    Reflect.set(window, 'electronAPI', undefined);
    const filename = `generado.${format}`;
    const render = vi.fn().mockResolvedValue({ content_base64: 'ZG9jdW1lbnRv', filename });

    await expect(renderAndDeliverDocument(payload, render, { defaultName: filename, format }))
      .resolves.toEqual({ filename });

    expect(api.dialogSave).not.toHaveBeenCalled();
    expect(render).toHaveBeenCalledExactlyOnceWith(payload);
    expect(downloadBase64Blob).toHaveBeenCalledExactlyOnceWith('ZG9jdW1lbnRv', filename, mimeType);
  });
});
