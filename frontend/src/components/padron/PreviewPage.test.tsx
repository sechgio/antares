import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createDefaultHeaderData, createInitialItems } from './data';
import PreviewPage from './PreviewPage';

const commonProps = {
  headerData: createDefaultHeaderData(),
  items: createInitialItems(18),
  orientation: 'landscape' as const,
  accionaLogo: 'acciona.png',
  sedapalLogo: 'sedapal.png',
  totalPages: 3,
};

describe('PreviewPage volante lurigancho variant', () => {
  it('renders the full upper layout on the first page', () => {
    render(
      <PreviewPage
        {...commonProps}
        variant="volante-lurigancho"
        pageNumber={1}
        isFirstPage
        isLastPage={false}
      />,
    );

    expect(
      screen.getByRole('heading', {
        name: 'NOTIFICACIÓN A TRAVÉS DE VOLANTES POR INTERRUPCIÓN DEL SERVICIO DE AGUA POTABLE',
      }),
    ).toBeInTheDocument();
    expect(screen.getByText('1 de 3')).toBeInTheDocument();
    expect(screen.queryByText('Página 1 de 3')).not.toBeInTheDocument();
    expect(screen.getByText('Responsable del volanteo :')).toBeInTheDocument();
  });

  it('keeps the table but omits the upper layout on later pages', () => {
    render(
      <PreviewPage
        {...commonProps}
        variant="volante-lurigancho"
        pageNumber={2}
        isFirstPage={false}
        isLastPage={false}
      />,
    );

    expect(
      screen.queryByRole('heading', {
        name: 'NOTIFICACIÓN A TRAVÉS DE VOLANTES POR INTERRUPCIÓN DEL SERVICIO DE AGUA POTABLE',
      }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Item' })).toBeInTheDocument();
    expect(screen.getByText('2 de 3')).toBeInTheDocument();
    expect(screen.getByText('Responsable del volanteo :')).toBeInTheDocument();
  });

  it('honors an explicit page number style override', () => {
    render(
      <PreviewPage
        {...commonProps}
        variant="volante-lurigancho"
        pageNumber={1}
        isFirstPage
        isLastPage={false}
        pageNumberStyle="pagina_de"
      />,
    );

    expect(screen.getByText('Página 1 de 3')).toBeInTheDocument();
    expect(screen.queryByText('1 de 3')).not.toBeInTheDocument();
  });

  it('applies size and font style overrides to the folio label', () => {
    const { container } = render(
      <PreviewPage
        {...commonProps}
        pageNumber={1}
        isFirstPage
        isLastPage={false}
        pageNumberSize="lg"
        pageNumberFontStyle="italic"
      />,
    );

    const footer = container.querySelector('.vpad-sheet-foot') as HTMLElement | null;
    expect(footer).toBeTruthy();
    expect(footer?.style.fontSize).toBe('14px');
    expect(footer?.style.fontStyle).toBe('italic');
    expect(footer?.style.fontWeight).toBe('400');
  });
});
