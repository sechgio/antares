import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import PadronView, { getRenderableExportSheets } from './PadronView';

describe('PadronView output formats', () => {
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
