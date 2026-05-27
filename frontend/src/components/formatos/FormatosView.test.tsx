import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import FormatosView, { safeBase64ToBytes } from './FormatosView';
import { DialogProvider } from '../../hooks/useDialog';
import { ToastProvider } from '../../hooks/useToast';

function renderFormatosView() {
  return render(
    <ToastProvider>
      <DialogProvider>
        <FormatosView />
      </DialogProvider>
    </ToastProvider>,
  );
}

describe('FormatosView', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('places the Formatos PDF label in the preview metadata bar', async () => {
    const electronApi = window.electronAPI!;
    vi.spyOn(electronApi, 'invoke').mockImplementation(async (method: string) => {
      if (method === 'formatos_list') return { formats: [] };
      return {};
    });

    renderFormatosView();

    expect(await screen.findByTestId('formatos-context-title')).toHaveTextContent('FORMATOS PDF');
    expect(screen.queryByTestId('formatos-sidebar-heading')).not.toBeInTheDocument();
  });

  it('fits the available panel height and does not show the max pages footer hint', async () => {
    const electronApi = window.electronAPI!;
    vi.spyOn(electronApi, 'invoke').mockImplementation(async (method: string) => {
      if (method === 'formatos_list') {
        return {
          formats: [
            {
              id: 'simple-overlay',
              nombre: 'Formato prueba',
              origen: 'builtin',
              enabled: true,
              persisted: true,
              strategy: 'simple_overlay',
              mapping: null,
              filename_pattern: '{n}.pdf',
              max_pages: 500,
              number_min: 1,
              number_max: 9999999,
              has_mapping: true,
            },
          ],
        };
      }
      return {};
    });

    const { container } = renderFormatosView();

    await screen.findByText('Generar PDF');

    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveClass('h-full');
    expect(root.style.height).toBe('');
    expect(screen.queryByText(/máx\.\s*500 páginas\s*\/\s*descarga/i)).not.toBeInTheDocument();
  });

  it('only enables sidebar scrolling while the visual mapping editor is open', async () => {
    const electronApi = window.electronAPI!;
    vi.spyOn(electronApi, 'invoke').mockImplementation(async (method: string) => {
      if (method === 'formatos_list') {
        return {
          formats: [
            {
              id: 'simple-overlay',
              nombre: 'Formato prueba',
              origen: 'builtin',
              enabled: true,
              persisted: true,
              strategy: 'simple_overlay',
              mapping: null,
              filename_pattern: '{n}.pdf',
              max_pages: 500,
              number_min: 1,
              number_max: 9999999,
              has_mapping: true,
            },
          ],
        };
      }
      return {};
    });

    renderFormatosView();

    const mappingToggle = await screen.findByText('Personalizar posición');
    expect(mappingToggle.closest('.overflow-y-auto')).toBeNull();

    fireEvent.click(mappingToggle);

    const mappingEditorTitle = await screen.findByText('Mapping Visual');
    expect(mappingEditorTitle.closest('.overflow-y-auto')).not.toBeNull();
  });

  it('rejects malformed base64 payloads before decoding', () => {
    expect(() => safeBase64ToBytes('%%%')).toThrow('Datos base64 corruptos');
    expect(() => safeBase64ToBytes('A')).toThrow('Datos base64 corruptos');
    expect(Array.from(safeBase64ToBytes('JVBERi0='))).toEqual([37, 80, 68, 70, 45]);
  });

  it('saves generated PDFs directly to disk instead of downloading base64 through IPC', async () => {
    const electronApi = window.electronAPI!;
    const invoke = vi.spyOn(electronApi, 'invoke').mockImplementation(async (method: string, params?: Record<string, unknown>) => {
      if (method === 'formatos_list') {
        return {
          formats: [
            {
              id: 'simple-overlay',
              nombre: 'Formato prueba',
              origen: 'builtin',
              enabled: true,
              persisted: true,
              strategy: 'simple_overlay',
              mapping: null,
              filename_pattern: '{n}.pdf',
              max_pages: 500,
              number_min: 1,
              number_max: 9999999,
              has_mapping: true,
            },
          ],
        };
      }
      if (method === 'formatos_generate') {
        if (params?.output_path) return { saved_path: params.output_path, filename: 'simple-overlay_0000001.pdf' };
        return { pdf_base64: 'JVBERi0=', filename: 'preview.pdf' };
      }
      if (method === 'dialog_save') return { paths: ['C:\\tmp\\simple-overlay_0000001.pdf'] };
      if (method === 'history_save') return { id: 1 };
      return {};
    });

    renderFormatosView();

    fireEvent.click(await screen.findByText('Generar PDF'));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('formatos_generate', expect.objectContaining({
        output_path: 'C:\\tmp\\simple-overlay_0000001.pdf',
      }));
    });
  });
});
