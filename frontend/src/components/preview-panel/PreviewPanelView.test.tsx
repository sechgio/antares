import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { ToastProvider } from '../../hooks/useToast';
import PreviewPanelView from './PreviewPanelView';

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
  });

  it('keeps the mapping list scroll position after deleting a custom column', () => {
    renderView();

    const scrollContainer = getMappingScrollContainer();
    fireEvent.scroll(scrollContainer, { target: { scrollTop: 96 } });
    Object.defineProperty(scrollContainer, 'scrollTop', { value: 96, configurable: true, writable: true });

    fireEvent.click(screen.getAllByTitle('Eliminar')[0]);

    expect(getMappingScrollContainer().scrollTop).toBe(96);
  });

  it('adds a custom column with Enter when the mapping select has focus', async () => {
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

    fireEvent.click(screen.getByRole('button', { name: /Agregar Columna Personalizada/i }));

    const nameInput = screen.getByPlaceholderText('Ej: FECHA CORTE');
    fireEvent.change(nameInput, {
      target: { value: 'SGIO EXTRA' },
    });

    const form = nameInput.closest('form');
    expect(form).toBeTruthy();
    const mappingSelect = within(form!).getByDisplayValue('-- Seleccionar Columna --') as HTMLSelectElement;

    fireEvent.change(mappingSelect, { target: { value: 'SGIO' } });
    fireEvent.keyDown(mappingSelect, { key: 'Enter', code: 'Enter' });

    expect(await screen.findByText('SGIO EXTRA')).toBeInTheDocument();
  });
});
