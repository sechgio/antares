import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../hooks/useToast';
import PreviewPanelView from './PreviewPanelView';

vi.mock('../../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      spreadsheetParse: vi.fn().mockResolvedValue({
        workbookName: 'datos.csv',
        sheets: [{ name: 'Sheet1', rows: [['SGIO', 'OTRA'], ['1', '2']] }],
        warnings: [],
      }),
      spreadsheetGetRows: vi.fn(),
      fileTokenCleanup: vi.fn().mockResolvedValue({ cleaned: true }),
    },
  };
});

vi.mock('../../utils/stageFile', () => ({
  stageFileForIpc: vi.fn().mockResolvedValue('ft_test'),
}));

const CUSTOM_COLS_KEY = 'antares_preview_custom_columns';

function renderView() {
  return render(
    <ToastProvider>
      <PreviewPanelView />
    </ToastProvider>,
  );
}

function getMappingScrollContainer() {
  const customColumnLabel = screen.getByText('PERSONALIZADA 2');
  const row = customColumnLabel.parentElement;
  const scrollContainer = row?.parentElement;
  if (!scrollContainer) {
    throw new Error('Mapping scroll container not found');
  }
  return scrollContainer;
}

describe('PreviewPanelView column mapping', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(CUSTOM_COLS_KEY, JSON.stringify([
      { id: 'custom_1', name: 'PERSONALIZADA 1', mappedTo: 'NOMBRE' },
      { id: 'custom_2', name: 'PERSONALIZADA 2', mappedTo: 'FECHA' },
    ]));
    const win = window as unknown as { electronAPI?: Record<string, unknown> };
    win.electronAPI = {
      ...(win.electronAPI || {}),
      fileStagedCreate: vi.fn(),
      fileStagedAppend: vi.fn(),
      fileStagedComplete: vi.fn(),
      onNotify: vi.fn(() => () => undefined),
    };
  });

  it('keeps the mapping list scroll position after deleting a custom column', () => {
    renderView();

    const scrollContainer = getMappingScrollContainer();
    fireEvent.scroll(scrollContainer, { target: { scrollTop: 96 } });
    Object.defineProperty(scrollContainer, 'scrollTop', { value: 96, configurable: true, writable: true });

    fireEvent.click(screen.getAllByRole('button', { name: 'Eliminar' })[0]);

    expect(getMappingScrollContainer().scrollTop).toBe(96);
  });

  it('imports CSV via backend spreadsheetParse and adds custom column', async () => {
    const { container } = renderView();
    const fileInput = container.querySelector('input[accept=".csv,.xlsx,.xls"]') as HTMLInputElement | null;

    expect(fileInput).toBeTruthy();
    fireEvent.change(fileInput!, {
      target: {
        files: [new File(['SGIO,OTRA\n1,2'], 'datos.csv', { type: 'text/csv' })],
      },
    });

    await waitFor(() => expect(screen.getByText('1 registros cargados')).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText('Cerrar vista previa'));

    fireEvent.click(screen.getByRole('button', { name: /Columna Personalizada/i }));

    const nameInput = screen.getByPlaceholderText('Ej: FECHA CORTE');
    fireEvent.change(nameInput, {
      target: { value: 'SGIO EXTRA' },
    });

    const form = nameInput.closest('form');
    expect(form).toBeTruthy();
    fireEvent.click(within(form!).getByRole('button', { name: 'Columna del Excel a Mapear' }));
    fireEvent.click(screen.getByRole('option', { name: 'SGIO' }));
    fireEvent.keyDown(nameInput, { key: 'Enter', code: 'Enter' });

    expect(await screen.findByText('SGIO EXTRA')).toBeInTheDocument();
  });
});
