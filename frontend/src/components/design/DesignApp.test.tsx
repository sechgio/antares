import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import DesignApp from './DesignApp';
import type { DesignDocument } from '@/api';

const designList = vi.fn();
const designGet = vi.fn();
const designGenerate = vi.fn();
const designRenderHtml = vi.fn();
const designPreflight = vi.fn();
const designMemoryGet = vi.fn();
const designMemoryAdd = vi.fn();
const designMemoryDelete = vi.fn();
const designMemoryClear = vi.fn();
const designExportPdf = vi.fn();
const designDelete = vi.fn();
const aiProvidersList = vi.fn();
const askPdfSavePath = vi.fn();
const addToast = vi.fn();

vi.mock('@/api', () => ({
  api: {
    designList: () => designList(),
    designGet: (id: string) => designGet(id),
    designGenerate: (body: unknown) => designGenerate(body),
        designRenderHtml: (body: unknown) => designRenderHtml(body),
    designPreflight: (body: unknown) => designPreflight(body),
    designMemoryGet: () => designMemoryGet(),
    designMemoryAdd: (text: string) => designMemoryAdd(text),
    designMemoryDelete: (id: string) => designMemoryDelete(id),
    designMemoryClear: () => designMemoryClear(),
    designExportPdf: (body: unknown) => designExportPdf(body),
    designDelete: (id: string) => designDelete(id),
  },
}));

vi.mock('@/api/aiProvidersApi', () => ({
  aiProvidersApi: { aiProvidersList: () => aiProvidersList() },
}));

vi.mock('@/hooks/useToast', () => ({ useToast: () => ({ addToast }) }));
vi.mock('@/utils/deliverRenderedDocument', () => ({ askPdfSavePath: (...a: unknown[]) => askPdfSavePath(...a) }));
vi.mock('@/utils/history', () => ({ saveFeatureHistory: vi.fn().mockResolvedValue(undefined) }));

const document_: DesignDocument = {
  version: 1,
  id: 'd1',
  name: 'Plan Q3',
  prompt: 'resultados del Q3',
  updatedAt: '2026-01-01T00:00:00.000Z',
  page: { preset: '16x9', widthMm: 338.667, heightMm: 190.5 },
  theme: {
    background: '#FFFFFF', surface: '#F3F4F6', text: '#111827',
    muted: '#6B7280', accent: '#2563EB', accentAlt: '#0F172A',
    headFont: 'Cambria', bodyFont: 'Calibri',
  },
  slides: [
    { id: 's1', layout: 'title', title: 'Portada', subtitle: '', body: '', bullets: [], left: [], right: [], statValue: '', statLabel: '', quoteText: '', quoteAuthor: '', notes: '' },
    { id: 's2', layout: 'section', title: 'Cierre', subtitle: '', body: '', bullets: [], left: [], right: [], statValue: '', statLabel: '', quoteText: '', quoteAuthor: '', notes: '' },
  ],
};

describe('DesignApp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    designList.mockResolvedValue({ designs: [] });
    designRenderHtml.mockResolvedValue({ html: '<p>ok</p>', slideCount: 2, page: document_.page });
        designPreflight.mockResolvedValue({ ok: true, slideCount: 2, findings: [], errorCount: 0, warningCount: 0 });
    designMemoryGet.mockResolvedValue({ memory: { version: 1, notes: [] } });
    designMemoryAdd.mockResolvedValue({ memory: { version: 1, notes: [] }, noteCount: 1 });
    designMemoryDelete.mockResolvedValue({ memory: { version: 1, notes: [] } });
    designMemoryClear.mockResolvedValue({ memory: { version: 1, notes: [] } });
    aiProvidersList.mockResolvedValue({
      providers: [
        { provider: 'openai', label: 'OpenAI', configured: true, default_model: 'gpt-4o-mini', has_key: true, key_masked: '••••1234', base_url: '', needs_key: true, description: '', docs: '', editable_base_url: true },
        { provider: 'ollama', label: 'Ollama', configured: false, default_model: 'llama3.1', has_key: false, key_masked: null, base_url: '', needs_key: false, description: '', docs: '', editable_base_url: true },
      ],
    });
  });

  it('exige un proveedor con clave y avisa cuando no hay ninguno', async () => {
    aiProvidersList.mockResolvedValue({ providers: [] });
    render(<DesignApp />);
    await waitFor(() => expect(screen.getByText(/No hay ningún proveedor/i)).toBeInTheDocument());
  });

  it('solo ofrece proveedores configurados', async () => {
    render(<DesignApp />);
    await waitFor(() => expect(aiProvidersList).toHaveBeenCalled());
    const combo = screen.getByRole('button', { name: 'Proveedor' });
    fireEvent.click(combo);
    await waitFor(() => expect(screen.getByRole('option', { name: 'OpenAI' })).toBeInTheDocument());
    expect(screen.queryByRole('option', { name: 'Ollama' })).not.toBeInTheDocument();
  });

  it('no genera sin prompt', async () => {
    render(<DesignApp />);
    await waitFor(() => expect(aiProvidersList).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: /Generar diseño/i }));
    await waitFor(() => expect(screen.getByText(/Describe qué quieres presentar/i)).toBeInTheDocument());
    expect(designGenerate).not.toHaveBeenCalled();
  });

  it('genera, previsualiza el HTML sanitizado y exporta a PDF', async () => {
    designGenerate.mockResolvedValue({ document: document_ });
    designExportPdf.mockResolvedValue({ filename: 'Plan Q3.pdf', saved_path: 'C:/tmp/Plan Q3.pdf' });
    askPdfSavePath.mockResolvedValue('C:/tmp/Plan Q3.pdf');

    render(<DesignApp />);
    await waitFor(() => expect(aiProvidersList).toHaveBeenCalled());

    fireEvent.change(screen.getByPlaceholderText(/Ej\.: resultados/i), { target: { value: 'resultados del Q3' } });
    fireEvent.click(screen.getByRole('button', { name: /Generar diseño/i }));

    await waitFor(() => expect(designGenerate).toHaveBeenCalledWith(expect.objectContaining({ prompt: 'resultados del Q3', provider: 'openai', page_preset: '16x9' })));

    const frame = await screen.findByTitle('Vista previa del diseño: Plan Q3') as HTMLIFrameElement;
    expect(frame.getAttribute('sandbox')).toBe('allow-same-origin');
    await waitFor(() => expect(designRenderHtml).toHaveBeenCalled());
    expect(screen.getByText(/1 \/ 2/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Exportar PDF/i }));
    await waitFor(() => expect(designExportPdf).toHaveBeenCalled());
    await waitFor(() => expect(addToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' })));
  });

  it('no exporta si el usuario cancela el diálogo', async () => {
    designGenerate.mockResolvedValue({ document: document_ });
    askPdfSavePath.mockResolvedValue(null);
    render(<DesignApp />);
    await waitFor(() => expect(aiProvidersList).toHaveBeenCalled());
    fireEvent.change(screen.getByPlaceholderText(/Ej\.: resultados/i), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: /Generar diseño/i }));
    await screen.findByTitle('Vista previa del diseño: Plan Q3');
    fireEvent.click(screen.getByRole('button', { name: /Exportar PDF/i }));
    await waitFor(() => expect(askPdfSavePath).toHaveBeenCalled());
    expect(designExportPdf).not.toHaveBeenCalled();
  });

  it('muestra el error del backend sin perder el prompt', async () => {
    designGenerate.mockRejectedValue(new Error('El proveedor no tiene API key guardada'));
    render(<DesignApp />);
    await waitFor(() => expect(aiProvidersList).toHaveBeenCalled());
    fireEvent.change(screen.getByPlaceholderText(/Ej\.: resultados/i), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: /Generar diseño/i }));
    await waitFor(() => expect(screen.getByText(/no tiene API key/i)).toBeInTheDocument());
    expect((screen.getByPlaceholderText(/Ej\.: resultados/i) as HTMLTextAreaElement).value).toBe('x');
  });

  it('pasa el control de calidad al previsualizar y lista los hallazgos', async () => {
    designGenerate.mockResolvedValue({ document: document_ });
    designPreflight.mockResolvedValue({
      ok: false,
      slideCount: 2,
      errorCount: 1,
      warningCount: 0,
      findings: [
        { kind: 'overflow', severity: 'error', slide: 2, message: 'El texto se sale del área segura.', detail: {} },
      ],
    });
    render(<DesignApp />);
    await waitFor(() => expect(aiProvidersList).toHaveBeenCalled());
    fireEvent.change(screen.getByPlaceholderText(/Ej\.: resultados/i), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: /Generar diseño/i }));

    await waitFor(() => expect(designPreflight).toHaveBeenCalled());
    expect(await screen.findByText(/se sale del área segura/i)).toBeInTheDocument();
    expect(screen.getByText('Dia. 2')).toBeInTheDocument();
  });

  it('navega con la tira de diapositivas y recarga bajo demanda', async () => {
    designGenerate.mockResolvedValue({ document: document_ });
    render(<DesignApp />);
    await waitFor(() => expect(aiProvidersList).toHaveBeenCalled());
    fireEvent.change(screen.getByPlaceholderText(/Ej\.: resultados/i), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: /Generar diseño/i }));
    await screen.findByTitle('Vista previa del diseño: Plan Q3');
    await waitFor(() => expect(designRenderHtml).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: /Diapositiva 2/i }));
    expect(screen.getByText(/2 \/ 2/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Recargar vista previa/i }));
    await waitFor(() => expect(designRenderHtml).toHaveBeenCalledTimes(2));
  });

  it('aplica la memoria en cada generacion y permite borrarla', async () => {
    designGenerate.mockResolvedValue({ document: document_ });
    designMemoryGet.mockResolvedValue({
      memory: { version: 1, notes: [{ id: 'n1', text: 'nada de degradados', createdAt: '' }] },
    });
    render(<DesignApp />);
    await waitFor(() => expect(designMemoryGet).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: /Preferencias de diseño/i }));
    expect(screen.getByText('nada de degradados')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Borrar preferencia/i }));
    await waitFor(() => expect(designMemoryDelete).toHaveBeenCalledWith('n1'));
  });

  it('guarda una preferencia nueva con Enter', async () => {
    designGenerate.mockResolvedValue({ document: document_ });
    render(<DesignApp />);
    await waitFor(() => expect(designMemoryGet).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: /Preferencias de diseño/i }));

    const field = screen.getByPlaceholderText(/nada de degradados/i);
    fireEvent.change(field, { target: { value: 'español formal' } });
    fireEvent.keyDown(field, { key: 'Enter' });

    await waitFor(() => expect(designMemoryAdd).toHaveBeenCalledWith('español formal'));
  });
});