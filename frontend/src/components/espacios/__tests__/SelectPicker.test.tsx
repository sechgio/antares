import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import SelectPicker from '../components/filters/SelectPicker';

const OPTIONS = [
  { value: 'all', label: 'Todos los estados' },
  { value: 'todo', label: 'Pendiente', color: '#87909E' },
  { value: 'in_progress', label: 'En curso', color: '#5F55EE' },
  { value: 'done', label: 'Completados', color: '#0F9D58' },
  { value: 'urgent', label: 'Urgente', color: '#EF4444' },
];

describe('SelectPicker', () => {
  it('opens a custom menu and selects an option', () => {
    const onChange = vi.fn();
    render(
      <SelectPicker
        value="all"
        options={OPTIONS}
        onChange={onChange}
        aria-label="Filtrar por estado"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Filtrar por estado/i }));
    const listbox = screen.getByRole('listbox', { name: /Filtrar por estado/i });
    expect(listbox).toBeInTheDocument();
    expect(listbox.parentElement).toBe(document.body);

    fireEvent.click(screen.getByRole('option', { name: /En curso/i }));
    expect(onChange).toHaveBeenCalledWith('in_progress');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('shows the current label on the trigger', () => {
    render(
      <SelectPicker
        value="urgent"
        options={OPTIONS}
        onChange={vi.fn()}
        aria-label="Filtrar por estado"
      />,
    );
    expect(screen.getByRole('button', { name: /Filtrar por estado/i })).toHaveTextContent('Urgente');
  });

  it('closes on Escape', () => {
    render(
      <SelectPicker
        value="all"
        options={OPTIONS}
        onChange={vi.fn()}
        aria-label="Estado"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Estado/i }));
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});
