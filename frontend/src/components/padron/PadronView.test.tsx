import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import PadronView, { getRenderableExportSheets, paginateLuriganchoItems } from './PadronView';
import { createInitialItems } from './data';

describe('PadronView output formats', () => {
  it('switches to the volante lurigancho layout while keeping padron controls', async () => {
    render(<PadronView />);

    fireEvent.click(screen.getByLabelText('Formato de salida'));
    fireEvent.click(screen.getByRole('option', { name: /volante lurigancho/i }));
    fireEvent.change(screen.getByDisplayValue('18'), { target: { value: '36' } });

    expect(screen.getByLabelText('Formato de salida')).toHaveTextContent(/volante lurigancho/i);
    expect(screen.getByText('Datos del Padrón')).toBeInTheDocument();
    expect(screen.getByText('Orientación')).toBeInTheDocument();
    expect(screen.getByText('1 de 2')).toBeInTheDocument();
  });

  it('switches to a separate water cut notice configuration', async () => {
    render(<PadronView />);

    expect(screen.getByLabelText('Formato de salida')).toHaveTextContent(/Plantilla actual/i);
    expect(screen.getByText('Datos del Padrón')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Formato de salida'));
    fireEvent.click(screen.getByRole('option', { name: /Aviso corte de agua/i }));

    expect(screen.getByLabelText('Formato de salida')).toHaveTextContent(/Aviso corte de agua/i);
    expect(screen.getByText('Datos del aviso de corte')).toBeInTheDocument();
    expect(screen.queryByText('Orientación')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /AVISO DE CORTE DEL SERVICIO DE AGUA POTABLE/i })).toBeInTheDocument();
  });
});

describe('volante lurigancho pagination', () => {
  it('uses a denser follow-up page after the first landscape sheet', () => {
    const pages = paginateLuriganchoItems(createInitialItems(49), 'landscape');

    expect(pages).toHaveLength(2);
    expect(pages[0]).toHaveLength(18);
    expect(pages[1]).toHaveLength(31);
  });

  it('uses a denser follow-up page after the first portrait sheet', () => {
    const pages = paginateLuriganchoItems(createInitialItems(87), 'portrait');

    expect(pages).toHaveLength(2);
    expect(pages[0]).toHaveLength(37);
    expect(pages[1]).toHaveLength(50);
  });
});

describe('padron folio controls', () => {
  function renderTwoPagePadron() {
    render(<PadronView />);
    fireEvent.change(screen.getByDisplayValue('18'), { target: { value: '36' } });
  }

  function sheetFooters(): string[] {
    return Array.from(document.querySelectorAll('.vpad-sheet-foot')).map(
      (el) => el.textContent?.trim() ?? '',
    );
  }

  it('keeps default sequential numbering in preview', () => {
    renderTwoPagePadron();
    expect(sheetFooters()).toEqual(['Página 1 de 2', 'Página 2 de 2']);
  });

  it('applies inverted folio numbering in preview', () => {
    renderTwoPagePadron();

    fireEvent.click(screen.getByRole('button', { name: /Foleado/i }));
    fireEvent.click(screen.getByLabelText(/Invertir orden/i));

    expect(sheetFooters()[0]).toBe('Página 2 de 2');
  });

  it('applies custom start folio in preview', () => {
    renderTwoPagePadron();

    fireEvent.click(screen.getByRole('button', { name: /Foleado/i }));

    const desdeInput = screen.getByLabelText('Desde');
    fireEvent.change(desdeInput, { target: { value: '2' } });

    const hastaInput = screen.getByLabelText('Hasta');
    fireEvent.change(hastaInput, { target: { value: '3' } });

    expect(sheetFooters()[0]).toBe('Página 2 de 2');
  });

  it('applies page number style in preview', () => {
    renderTwoPagePadron();

    fireEvent.click(screen.getByRole('button', { name: /Foleado/i }));
    fireEvent.click(screen.getByLabelText('Formato de numeración de página'));
    fireEvent.click(screen.getByRole('option', { name: /^N de X/i }));

    expect(sheetFooters()).toEqual(['1 de 2', '2 de 2']);
    expect(sheetFooters().some((t) => t.startsWith('Página'))).toBe(false);

    fireEvent.click(screen.getByLabelText('Formato de numeración de página'));
    fireEvent.click(screen.getByRole('option', { name: /^Solo número/i }));

    expect(sheetFooters()).toEqual(['1', '2']);
  });

  it('applies page number size and font style in preview', () => {
    renderTwoPagePadron();

    fireEvent.click(screen.getByRole('button', { name: /Foleado/i }));
    fireEvent.click(screen.getByLabelText('Tamaño de numeración de página'));
    fireEvent.click(screen.getByRole('option', { name: /Extra grande/i }));
    fireEvent.click(screen.getByLabelText('Estilo tipográfico de numeración de página'));
    fireEvent.click(screen.getByRole('option', { name: /Negrita cursiva/i }));

    const footer = document.querySelector('.vpad-sheet-foot') as HTMLElement | null;
    expect(footer).toBeTruthy();
    expect(footer?.style.fontSize).toBe('18px');
    expect(footer?.style.fontWeight).toBe('700');
    expect(footer?.style.fontStyle).toBe('italic');
  });
});

describe('padron PDF export guards', () => {
  it('only returns export sheets that have a measurable width', () => {
    const wrapper = document.createElement('div');
    const hiddenSheet = document.createElement('div');
    hiddenSheet.className = 'vpad-sheet';
    const visibleSheet = document.createElement('div');
    visibleSheet.className = 'vpad-sheet';

    Object.defineProperty(hiddenSheet, 'offsetWidth', { value: 0 });
    Object.defineProperty(visibleSheet, 'offsetWidth', { value: 1123 });

    wrapper.append(hiddenSheet, visibleSheet);

    expect(getRenderableExportSheets(wrapper)).toEqual([visibleSheet]);
  });
});
