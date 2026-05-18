import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import PadronView, { getRenderableExportSheets, paginateLuriganchoItems } from './PadronView';
import { createInitialItems } from './data';

describe('PadronView output formats', () => {
  it('switches to the volante lurigancho layout while keeping padron controls', async () => {
    render(<PadronView />);

    const formatSelect = screen.getByLabelText('Formato de salida');
    fireEvent.change(formatSelect, { target: { value: 'volante-lurigancho' } });
    fireEvent.change(screen.getByDisplayValue('18'), { target: { value: '36' } });

    expect(formatSelect).toHaveValue('volante-lurigancho');
    expect(screen.getByText('Datos del Padrón')).toBeInTheDocument();
    expect(screen.getByText('Orientación')).toBeInTheDocument();
    expect(screen.getByText('1 de 2')).toBeInTheDocument();
  });

  it('switches to a separate water cut notice configuration', async () => {
    render(<PadronView />);

    const formatSelect = screen.getByLabelText('Formato de salida');
    expect(formatSelect).toHaveValue('service-interruption');
    expect(screen.getByText('Datos del Padrón')).toBeInTheDocument();

    fireEvent.change(formatSelect, { target: { value: 'water-cut-notice' } });

    expect(formatSelect).toHaveValue('water-cut-notice');
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
