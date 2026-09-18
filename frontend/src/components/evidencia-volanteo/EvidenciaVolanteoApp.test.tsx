import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const addToast = vi.fn();
const confirm = vi.fn().mockResolvedValue(true);
const sessionState: Record<string, unknown> = {};

const exportEvidenciaDocument = vi.fn().mockResolvedValue({ filename: 'out.pdf' });
const saveFeatureHistory = vi.fn().mockResolvedValue(undefined);

vi.mock('../../hooks/useToast', () => ({ useToast: () => ({ addToast }) }));
vi.mock('../../hooks/useDialog', () => ({ useDialog: () => ({ confirm }) }));
vi.mock('./utils/exportDocument', () => ({
  exportEvidenciaDocument: (...a: unknown[]) => exportEvidenciaDocument(...a),
}));
vi.mock('../../utils/history', () => ({
  saveFeatureHistory: (...a: unknown[]) => saveFeatureHistory(...a),
}));

vi.mock('./components/DualLogoPicker', () => ({
  default: () => <div data-testid="logo-picker" />,
}));
vi.mock('./components/TitleForm', () => ({
  default: ({ title }: { title: string }) => <div data-testid="title-form">{title}</div>,
}));
vi.mock('./components/CuadranteRangesEditor', () => ({
  default: () => <div data-testid="ranges-editor" />,
}));
vi.mock('./components/ImageUploader', () => ({
  default: ({ onClear }: { onClear: () => void }) => (
    <button data-testid="clear-images" onClick={onClear} />
  ),
}));
vi.mock('./components/SheetPreview', () => ({
  default: () => <div data-testid="sheet-preview" />,
}));
vi.mock('./components/ExportBar', () => ({
  default: () => <div data-testid="export-bar" />,
}));

vi.mock('./hooks/useEvidenciaSession', () => ({
  useEvidenciaSession: () => sessionState,
}));

import EvidenciaVolanteoApp from './EvidenciaVolanteoApp';
import { MSG_NO_IMAGES, MSG_TITLE_REQUIRED } from './constants';

function makeSession(overrides: Record<string, unknown> = {}) {
  Object.assign(sessionState, {
    title: '',
    images: [],
    logoLeft: null,
    logoRight: null,
    cuadranteRanges: [],
    currentCuadrante: null,
    cuadranteLabel: 'CUADRANTE',
    showCuadranteLabel: true,
    currentPageImages: [],
    currentPageIndex: 0,
    totalPages: 0,
    isExporting: false,
    setLogo: vi.fn().mockReturnValue(null),
    setTitle: vi.fn(),
    setCuadranteLabel: vi.fn(),
    setShowCuadranteLabel: vi.fn(),
    setCuadranteRanges: vi.fn(),
    addCuadranteRange: vi.fn(),
    addImages: vi.fn(),
    removeImage: vi.fn(),
    clearImages: vi.fn(),
    setCurrentPageIndex: vi.fn(),
    setIsExporting: vi.fn(),
    ...overrides,
  });
  return sessionState;
}

describe('EvidenciaVolanteoApp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const k of Object.keys(sessionState)) delete sessionState[k];
  });

  it('renderiza las tres zonas', () => {
    makeSession();
    render(<EvidenciaVolanteoApp />);
    expect(screen.getByTestId('logo-picker')).toBeInTheDocument();
    expect(screen.getByTestId('sheet-preview')).toBeInTheDocument();
    expect(screen.getByTestId('ranges-editor')).toBeInTheDocument();
  });

  it('exportar sin título muestra toast de error y no llama a export', async () => {
    makeSession({ title: '   ', images: [{ id: 'i1', objectUrl: 'blob:x' }] });
    render(<EvidenciaVolanteoApp />);
    fireEvent.click(screen.getByText('Exportar documento'));
    await waitFor(() =>
      expect(addToast).toHaveBeenCalledWith(expect.objectContaining({ message: MSG_TITLE_REQUIRED, type: 'error' })),
    );
    expect(exportEvidenciaDocument).not.toHaveBeenCalled();
  });

  it('exportar sin imágenes muestra toast de error', async () => {
    makeSession({ title: 'Título' });
    render(<EvidenciaVolanteoApp />);
    fireEvent.click(screen.getByText('Exportar documento'));
    await waitFor(() =>
      expect(addToast).toHaveBeenCalledWith(expect.objectContaining({ message: MSG_NO_IMAGES, type: 'error' })),
    );
    expect(exportEvidenciaDocument).not.toHaveBeenCalled();
  });

  it('exportación exitosa guarda historial y toast de éxito', async () => {
    const setIsExporting = vi.fn();
    makeSession({
      title: 'Doc',
      images: [{ id: 'i1', objectUrl: 'blob:x' }],
      totalPages: 1,
      setIsExporting,
    });
    render(<EvidenciaVolanteoApp />);
    fireEvent.click(screen.getByText('Exportar documento'));
    await waitFor(() => expect(exportEvidenciaDocument).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(addToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' })),
    );
    expect(saveFeatureHistory).toHaveBeenCalledWith(
      'evidencia_volanteo',
      'out.pdf',
      expect.objectContaining({ format: 'pdf', images: 1 }),
      1,
    );
    expect(setIsExporting).toHaveBeenNthCalledWith(1, true);
    expect(setIsExporting).toHaveBeenLastCalledWith(false);
  });

  it('error de exportación produce toast de error y libera isExporting', async () => {
    exportEvidenciaDocument.mockRejectedValueOnce(new Error('falló'));
    const setIsExporting = vi.fn();
    makeSession({ title: 'Doc', images: [{ id: 'i1' }], setIsExporting });
    render(<EvidenciaVolanteoApp />);
    fireEvent.click(screen.getByText('Exportar documento'));
    await waitFor(() =>
      expect(addToast).toHaveBeenCalledWith(expect.objectContaining({ message: 'falló', type: 'error' })),
    );
    expect(setIsExporting).toHaveBeenLastCalledWith(false);
  });

  it('Ctrl+Enter dispara exportar', async () => {
    makeSession({ title: 'Doc', images: [{ id: 'i1' }] });
    render(<EvidenciaVolanteoApp />);
    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(exportEvidenciaDocument).toHaveBeenCalledTimes(1));
  });

  it('limpiar imágenes pasa por confirmación', async () => {
    const clearImages = vi.fn();
    makeSession({ clearImages });
    render(<EvidenciaVolanteoApp />);
    fireEvent.click(screen.getByTestId('clear-images'));
    await waitFor(() => expect(clearImages).toHaveBeenCalledTimes(1));
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ type: 'destructive' }));
  });

  it('navegación de hojas respeta los límites', () => {
    const setCurrentPageIndex = vi.fn();
    makeSession({ totalPages: 3, currentPageIndex: 1, setCurrentPageIndex });
    render(<EvidenciaVolanteoApp />);
    fireEvent.click(screen.getByLabelText('Hoja anterior'));
    expect(setCurrentPageIndex).toHaveBeenCalledWith(0);
    fireEvent.click(screen.getByLabelText('Hoja siguiente'));
    expect(setCurrentPageIndex).toHaveBeenCalledWith(2);
  });
});
