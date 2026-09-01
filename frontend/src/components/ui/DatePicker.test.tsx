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
        placeholder="Seleccionar"
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

  it('portals the calendar outside overflow-hidden ancestors', () => {
    const onChange = vi.fn();
    const { container } = render(
      <div style={{ overflow: 'hidden', height: 40 }}>
        <DatePicker value="" onChange={onChange} aria-label="Fecha" />
      </div>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Fecha' }));
    const dialog = screen.getByRole('dialog', { name: 'Fecha' });
    expect(dialog).toBeInTheDocument();
    expect(container.contains(dialog)).toBe(false);
    expect(document.body.contains(dialog)).toBe(true);
  });

  it('supports keyboard navigation and returns focus to the trigger on close', () => {
    const onChange = vi.fn();
    render(<DatePicker value="2026-09-01" onChange={onChange} aria-label="Fecha" />);

    const trigger = screen.getByRole('button', { name: 'Fecha' });
    fireEvent.click(trigger);

    const currentDay = screen.getByRole('button', { name: 'martes, 1 de septiembre de 2026' });
    expect(document.activeElement).toBe(currentDay);

    fireEvent.keyDown(currentDay, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'miércoles, 2 de septiembre de 2026' }),
    );

    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('2026-09-02');
    expect(document.activeElement).toBe(trigger);
  });
});
