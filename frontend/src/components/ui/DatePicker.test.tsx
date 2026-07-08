import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import DatePicker from './DatePicker';

describe('DatePicker', () => {
  it('opens a themed calendar popup and selects a date', () => {
    const onChange = vi.fn();
    render(
      <DatePicker
        value=""
        onChange={onChange}
        placeholder="Seleccionar fecha"
        aria-label="Fecha de vencimiento"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Fecha de vencimiento' }));
    expect(screen.getByRole('dialog', { name: 'Fecha de vencimiento' })).toBeInTheDocument();
    expect(screen.getByText('Hoy')).toBeInTheDocument();

    const dayButtons = screen.getAllByRole('button').filter((btn) => /^\d{1,2}$/.test(btn.textContent ?? ''));
    fireEvent.click(dayButtons[0]);
    expect(onChange).toHaveBeenCalledWith(expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
  });

  it('clears the selected date', () => {
    const onChange = vi.fn();
    render(<DatePicker value="2026-07-06" onChange={onChange} aria-label="Fecha" />);

    fireEvent.click(screen.getByRole('button', { name: 'Fecha' }));
    fireEvent.click(screen.getByRole('button', { name: 'Borrar' }));
    expect(onChange).toHaveBeenCalledWith('');
  });
});