import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const addToast = vi.fn();
const confirm = vi.fn().mockResolvedValue(true);
const sessionState: Record<string, unknown> = {};

const exportPanelDocument = vi.fn().mockResolvedValue({ filename: 'panel.pdf' });
const saveFeatureHistory = vi.fn().mockResolvedValue(undefined);

vi.mock('../../hooks/useToast', () => ({ useToast: () => ({ addToast }) }));
vi.mock('../../hooks/useDialog', () => ({ useDialog: () => ({ confirm }) }));
vi.mock('./utils/exportPdf', () => ({
  exportPanelDocument: (...a: unknown[]) => exportPanelDocument(...a),
}));
vi.mock('../../utils/history', () => ({
  saveFeatureHistory: (...a: unknown[]) => saveFeatureHistory(...a),
}));

vi.mock('./components/HeaderForm', () => ({
  default: () => <div data-testid="header-form" />,
}));
vi.mock('./components/LogoPicker', () => ({
  default: () => <div data-testid="logo-picker" />,
}));
vi.mock('./components/ImageUploader', () => ({
  default: ({ onClear }: { onClear: () => void }) => (
    <button data-testid="clear-images" onClick={onClear} />
  ),
}));
vi.mock('./components/ExcelImporter', () => ({
  default: () => <div data-testid="excel-importer" />,
}));
vi.mock('./components/MatchRuleEditor', () => ({
  default: () => <div data-testid="match-rule" />,
}));
vi.mock('./components/AddressColumnSelector', () => ({
  default: () => <div data-testid="address-col" />,
}));
vi.mock('./components/SummaryPanel', () => ({
  default: () => <div data-testid="summary" />,
}));
vi.mock('./components/SheetPreview', () => ({
  default: () => <div data-testid="sheet-preview" />,
}));
vi.mock('./components/ExportBar', () => ({
  default: () => <div data-testid="export-bar" />,
}));
vi.mock('../ui/ThemedSelect', () => ({
  default: ({ 'aria-label': label }: { 'aria-label'?: string }) => (
    <div aria-label={label} />
  ),
}));

vi.mock('./hooks/usePanelSession', () => ({
  usePanelSession: () => sessionState,
}));

import PanelAvisoCorteApp from './PanelAvisoCorteApp';
import { MSG_CUADRANTE_REQUIRED, MSG_NO_PANELS } from './constants';

function makeSession(overrides: Record<string, unknown> = {}) {
  Object.assign(sessionState, {
    images: [],
    logoRight: null,
    excelSource: null,
    headerForm: { cuadrante: '' },
    matchResult: null,
    isExporting: false,
    errors: [],
    previewPanels: [],
    currentPageIndex: 0,
    exportMode: 'include_empty',
    matchRule: { strategy: 'exact', key_column: 'clave' },
    addressColumn: null,
    setHeaderForm: vi.fn(),
    setLogoRight: vi.fn(),
    addImages: vi.fn(),
    removeImage: vi.fn(),
    clearImages: vi.fn(),
    setExcelSource: vi.fn(),
    setMatchRule: vi.fn(),
    setAddressColumn: vi.fn(),
    setIsExporting: vi.fn(),
    clearErrors: vi.fn(),
    setCurrentPageIndex: vi.fn(),
    setExportMode: vi.fn(),
    ...overrides,
  });
  return sessionState;
}

describe('PanelAvisoCorteApp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const k of Object.keys(sessionState)) delete sessionState[k];
  });

  it('renderiza sidebar, preview y barra de exportación', () => {
    makeSession();
    render(<PanelAvisoCorteApp />);
    expect(screen.getByTestId('header-form')).toBeInTheDocument();
    expect(screen.getByTestId('excel-importer')).toBeInTheDocument();
    expect(screen.getByTestId('sheet-preview')).toBeInTheDocument();
  });

  it('muestra MatchRuleEditor solo cuando hay excelSource', () => {
    makeSession();
    const { rerender } = render(<PanelAvisoCorteApp />);
    expect(screen.queryByTestId('match-rule')).toBeNull();

    makeSession({ excelSource: { columns: ['Clave'] } });
    rerender(<PanelAvisoCorteApp />);
    expect(screen.getByTestId('match-rule')).toBeInTheDocument();
    expect(screen.getByTestId('address-col')).toBeInTheDocument();
  });

  it('exportar sin paneles muestra MSG_NO_PANELS (vía Ctrl+Enter; el botón queda disabled)', async () => {
    makeSession({ previewPanels: [] });
    render(<PanelAvisoCorteApp />);
    expect(screen.getByLabelText('Exportar documento')).toBeDisabled();
    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true });
    await waitFor(() =>
      expect(addToast).toHaveBeenCalledWith(expect.objectContaining({ message: MSG_NO_PANELS, type: 'error' })),
    );
    expect(exportPanelDocument).not.toHaveBeenCalled();
  });

  it('exportar sin cuadrante ni excel muestra MSG_CUADRANTE_REQUIRED', async () => {
    makeSession({
      previewPanels: [{ id: 'p1' }],
      images: [],
      headerForm: { cuadrante: '  ' },
    });
    render(<PanelAvisoCorteApp />);
    fireEvent.click(screen.getByLabelText('Exportar documento'));
    await waitFor(() =>
      expect(addToast).toHaveBeenCalledWith(expect.objectContaining({ message: MSG_CUADRANTE_REQUIRED, type: 'error' })),
    );
    expect(exportPanelDocument).not.toHaveBeenCalled();
  });

  it('exportación exitosa guarda historial y toast de éxito', async () => {
    const setIsExporting = vi.fn();
    makeSession({
      previewPanels: [{ id: 'p1' }],
      excelSource: { columns: ['Clave'] },
      setIsExporting,
    });
    render(<PanelAvisoCorteApp />);
    fireEvent.click(screen.getByLabelText('Exportar documento'));
    await waitFor(() => expect(exportPanelDocument).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(addToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' })),
    );
    expect(saveFeatureHistory).toHaveBeenCalledWith(
      'panel_aviso_corte',
      'panel.pdf',
      expect.objectContaining({ format: 'pdf', panels: 1 }),
      1,
    );
    expect(setIsExporting).toHaveBeenLastCalledWith(false);
  });

  it('errores de sesión se muestran y Descartar llama clearErrors', () => {
    const clearErrors = vi.fn();
    makeSession({ errors: ['algo falló'], clearErrors });
    render(<PanelAvisoCorteApp />);
    expect(screen.getByText('algo falló')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Descartar'));
    expect(clearErrors).toHaveBeenCalledTimes(1);
  });

  it('limpiar imágenes pasa por confirmación destructiva', async () => {
    const clearImages = vi.fn();
    makeSession({ clearImages });
    render(<PanelAvisoCorteApp />);
    fireEvent.click(screen.getByTestId('clear-images'));
    await waitFor(() => expect(clearImages).toHaveBeenCalledTimes(1));
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ type: 'destructive' }));
  });
});
