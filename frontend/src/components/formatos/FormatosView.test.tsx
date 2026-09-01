import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FormatosView, { safeBase64ToBytes } from './FormatosView';
import { DialogProvider } from '../../hooks/useDialog';
import { ToastProvider } from '../../hooks/useToast';
import { invalidateApiCache } from '../../api';

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
  beforeEach(() => {
    invalidateApiCache();
  });

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

  it('loads template preview in mapping mode and syncs manual X with overlay', async () => {
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
      if (method === 'formatos_render_template_page') {
        return {
          image_base64: 'aW1n',
          page_width: 595,
          page_height: 842,
          mime_type: 'image/png',
        };
      }
      if (method === 'formatos_generate') {
        return { pdf_base64: 'JVBERi0=', filename: 'preview.pdf' };
      }
      return {};
    });

    renderFormatosView();

    fireEvent.click(await screen.findByText('Personalizar posición'));

    expect(await screen.findByText('Vista template · arrastra el recuadro')).toBeInTheDocument();
    expect(screen.getByDisplayValue('500')).toBeInTheDocument();
    expect(screen.getByText('Color del número')).toBeInTheDocument();
    expect(screen.queryByText(/R, G, B: 0-1/i)).not.toBeInTheDocument();
  });

  it('shows restart guidance when template IPC is blocked in mapping mode', async () => {
    const electronApi = window.electronAPI!;
    vi.spyOn(electronApi, 'invoke').mockImplementation(async (method: string) => {
      if (method === 'formatos_list') {
        return {
          formats: [
            {
              id: 'upload-visual',
              nombre: 'VIA PUBLICA - VES',
              origen: 'uploaded',
              enabled: true,
              persisted: true,
              strategy: 'visual_overlay',
              mapping: null,
              filename_pattern: '{n}.pdf',
              max_pages: 500,
              number_min: 1,
              number_max: 9999999,
              has_mapping: false,
            },
          ],
        };
      }
      if (method === 'formatos_render_template_page') {
        throw new Error("Error invoking remote method 'ipc-call': Error: IPC method not allowed: formatos_render_template_page");
      }
      if (method === 'formatos_get_template') {
        throw new Error("Error invoking remote method 'ipc-call': Error: IPC method not allowed: formatos_get_template");
      }
      return {};
    });

    renderFormatosView();

    fireEvent.click(await screen.findByText('Configurar mapping'));

    expect(await screen.findByText(/reinicia la aplicación.*npm run dev/i)).toBeInTheDocument();
  });

  it('calls formatos_generate only once when saving mapping (no duplicate auto-preview refetch)', async () => {
    const electronApi = window.electronAPI!;
    let generateCallCount = 0;
    const defaultMapping = {
      page: 0,
      x: 500,
      y: 30,
      width: 140,
      height: 20,
      font_size: 12,
      font_name: 'Helvetica-Bold',
      color_r: 0,
      color_g: 0,
      color_b: 0,
      padding: 7,
      blank_x: null,
      blank_y: null,
      blank_width: null,
      blank_height: null,
      redraw_top_border: false,
      redraw_ot_badge: false,
      blank_mcids: null,
    };

    vi.spyOn(electronApi, 'invoke').mockImplementation(async (method: string, params?: Record<string, unknown>) => {
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
        generateCallCount += 1;
        return { pdf_base64: 'JVBERi0=', filename: 'preview.pdf' };
      }
      if (method === 'formatos_render_template_page') {
        return {
          image_base64: 'aW1n',
          page_width: 595,
          page_height: 842,
          mime_type: 'image/png',
        };
      }
      if (method === 'formatos_update_mapping') {
        return {
          format: {
            id: 'simple-overlay',
            nombre: 'Formato prueba',
            origen: 'builtin',
            enabled: true,
            persisted: true,
            strategy: 'visual_overlay',
            mapping: { ...defaultMapping, ...(params?.mapping as object) },
            filename_pattern: '{n}.pdf',
            max_pages: 500,
            number_min: 1,
            number_max: 9999999,
            has_mapping: true,
          },
        };
      }
      return {};
    });

    renderFormatosView();

    await waitFor(() => expect(generateCallCount).toBeGreaterThanOrEqual(1), { timeout: 3000 });
    const countBeforeSave = generateCallCount;

    fireEvent.click(await screen.findByText('Personalizar posición'));
    await screen.findByText('Mapping Visual');

    fireEvent.click(screen.getByText('Guardar'));

    await waitFor(() => {
      expect(screen.queryByText('Editando mapping')).not.toBeInTheDocument();
    });

    await waitFor(() => expect(generateCallCount).toBe(countBeforeSave + 1), { timeout: 3000 });

    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(generateCallCount).toBe(countBeforeSave + 1);
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
