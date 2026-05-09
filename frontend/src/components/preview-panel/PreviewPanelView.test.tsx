import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { ToastProvider } from '../../hooks/useToast';
import PreviewPanelView from './PreviewPanelView';

const CUSTOM_COLS_KEY = 'cosmo_preview_custom_columns';

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
});
