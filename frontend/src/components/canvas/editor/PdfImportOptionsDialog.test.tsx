import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import PdfImportOptionsDialog from './PdfImportOptionsDialog';

describe('PdfImportOptionsDialog', () => {
  it('confirms the default page range', () => {
    const onConfirm = vi.fn();
    render(
      <PdfImportOptionsDialog
        preflight={{ pageCount: 3, pageSizes: [], hasMixedPageSizes: false }}
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Importar' }));

    expect(onConfirm).toHaveBeenCalledWith({
      pageStart: 1,
      pageEnd: 3,
      mixedPagePolicy: 'reject',
    });
  });

  it('allows scaling mixed page sizes', () => {
    const onConfirm = vi.fn();
    render(
      <PdfImportOptionsDialog
        preflight={{
          pageCount: 2,
          pageSizes: [],
          hasMixedPageSizes: true,
        }}
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    fireEvent.click(screen.getByLabelText('Escalar al primer tamaño'));
    fireEvent.click(screen.getByRole('button', { name: 'Importar' }));

    expect(onConfirm).toHaveBeenCalledWith({
      pageStart: 1,
      pageEnd: 2,
      mixedPagePolicy: 'scale-to-first',
    });
  });

  it('caps the selectable range at the import page budget', () => {
    render(
      <PdfImportOptionsDialog
        preflight={{ pageCount: 100, pageSizes: [], hasMixedPageSizes: false }}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('Hasta')).toHaveValue(50);
    expect(screen.getByLabelText('Hasta')).toHaveAttribute('max', '50');
  });
});
