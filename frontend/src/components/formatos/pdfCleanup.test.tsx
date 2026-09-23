import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import FormatosView from './FormatosView';
import MappingPreviewPanel from './MappingPreviewPanel';
import { DialogProvider } from '../../hooks/useDialog';
import { ToastProvider } from '../../hooks/useToast';
import type { VisualMapping } from '../../types';

const { getDocument, renderMappingPageToDataUrl } = vi.hoisted(() => ({
  getDocument: vi.fn(),
  renderMappingPageToDataUrl: vi.fn(),
}));

vi.mock('../../lib/pdfjs', () => ({ ensurePdfJs: async () => ({ getDocument }) }));
vi.mock('./MappingOverlay', () => ({ default: () => null }));
vi.mock('./mappingPdfRender', async (importOriginal) => ({
  ...await importOriginal<typeof import('./mappingPdfRender')>(),
  renderMappingPageToDataUrl,
}));

beforeEach(() => {
  getDocument.mockReset();
  renderMappingPageToDataUrl.mockReset();
  vi.spyOn(Blob.prototype, 'arrayBuffer').mockResolvedValue(new Uint8Array([1]).buffer);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('libera el PDF al desmontar Formatos durante un frame pendiente', async () => {
  const destroy = vi.fn(async () => {});
  getDocument.mockReturnValue({ promise: Promise.resolve({ numPages: 1, destroy }) });
  const frame = vi.fn(() => 1);
  vi.stubGlobal('requestAnimationFrame', frame);
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.spyOn(window.electronAPI!, 'invoke').mockImplementation(async (method: string) => {
    if (method === 'formatos_list') return { formats: [{
      id: 'simple-overlay', nombre: 'Formato prueba', origen: 'builtin', enabled: true,
      persisted: true, strategy: 'simple_overlay', mapping: null,
      filename_pattern: '{n}.pdf', max_pages: 500, number_min: 1,
      number_max: 9999999, has_mapping: true,
    }] };
    if (method === 'formatos_generate') return { pdf_base64: 'JVBERi0=', filename: 'preview.pdf' };
    return {};
  });

  const { unmount } = render(
    <ToastProvider><DialogProvider><FormatosView /></DialogProvider></ToastProvider>,
  );
  await waitFor(() => expect(frame).toHaveBeenCalled(), { timeout: 3000 });
  unmount();
  await waitFor(() => expect(destroy).toHaveBeenCalledOnce());
});

it('libera el PDF del fallback de mapping después de renderizar', async () => {
  const destroy = vi.fn(async () => {});
  getDocument.mockReturnValue({ promise: Promise.resolve({ numPages: 1, destroy }) });
  renderMappingPageToDataUrl.mockResolvedValue({
    url: 'data:image/jpeg;base64,aW1n', pageSize: { width: 595, height: 842 },
  });
  vi.spyOn(window.electronAPI!, 'invoke').mockImplementation(async (method: string) => {
    if (method === 'formatos_render_template_page') throw new Error('backend unavailable');
    return {};
  });

  render(<MappingPreviewPanel
    formatId="simple-overlay"
    mapping={{ page: 0, x: 1, y: 1, width: 10, height: 10 } as VisualMapping}
    onChange={vi.fn()}
    zoom={100}
    previewBlob={new Blob([new Uint8Array([1])], { type: 'application/pdf' })}
  />);

  expect(await screen.findByAltText('Template página 1')).toBeInTheDocument();
  await waitFor(() => expect(destroy).toHaveBeenCalledOnce());
});
