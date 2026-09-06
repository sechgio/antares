import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DialogProvider } from '../../hooks/useDialog';
import { ToastProvider } from '../../hooks/useToast';
import FichasTecnicasApp from './FichasTecnicasApp';

const { listMock } = vi.hoisted(() => ({
  listMock: vi.fn(async () => ({ fichas: [], total: 0 })),
}));

vi.mock('./api', () => ({
  fichasTecnicasApi: {
    list: listMock,
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    clear: vi.fn(),
    importFile: vi.fn(),
    renderHtml: vi.fn(),
    renderConsolidatedHtml: vi.fn(),
    htmlToPdf: vi.fn(),
  },
  downloadBase64Pdf: vi.fn(),
  fileToBase64: vi.fn(),
  fileToDataUrl: vi.fn(),
}));

function renderApp() {
  return render(
    <ToastProvider>
      <DialogProvider>
        <FichasTecnicasApp />
      </DialogProvider>
    </ToastProvider>,
  );
}

describe('FichasTecnicasApp focus mode', () => {
  beforeEach(() => {
    listMock.mockResolvedValue({ fichas: [], total: 0 });
    localStorage.clear();
  });

  it('gives the preview the full workspace when Ctrl+. hides the sidebars', async () => {
    renderApp();

    await waitFor(() => expect(listMock).toHaveBeenCalled());

    const workspace = document.querySelector('.tr-workspace') as HTMLElement;
    expect(workspace).toBeTruthy();
    expect(workspace).toHaveAttribute('data-focus-mode', 'off');
    expect(workspace.querySelector('.tr-database')).toBeTruthy();
    expect(workspace.querySelector('.tr-form')).toBeTruthy();
    expect(workspace.querySelector('.tr-preview-wrap')).toBeTruthy();

    fireEvent.keyDown(window, { key: '.', ctrlKey: true });

    expect(workspace).toHaveClass('is-focus');
    expect(workspace).toHaveAttribute('data-focus-mode', 'on');
    expect(workspace).not.toHaveStyle({ gridTemplateColumns: '0px 1fr 0px' });
    expect(workspace.querySelector('.tr-database')).toBeNull();
    expect(workspace.querySelector('.tr-form')).toBeNull();
    expect(workspace.children).toHaveLength(1);
    expect(workspace.querySelector('.tr-preview-wrap')).toBeTruthy();
    expect(screen.getByTestId('ficha-preview-paper')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Anterior' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Siguiente' })).toBeInTheDocument();
  });
});
