import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import StatusPicker from '../components/StatusPicker';

describe('StatusPicker', () => {
  it('opens a custom menu and selects a status', () => {
    const onChange = vi.fn();
    render(<StatusPicker value="todo" onChange={onChange} label="Estado de prueba" />);

    fireEvent.click(screen.getByRole('button', { name: /Estado de prueba/i }));
    const listbox = screen.getByRole('listbox', { name: /Seleccionar estado/i });
    expect(listbox).toBeInTheDocument();
    expect(listbox.parentElement).toBe(document.body);

    fireEvent.click(screen.getByRole('option', { name: /En progreso/i }));
    expect(onChange).toHaveBeenCalledWith('in_progress');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('shows current label on the trigger', () => {
    render(<StatusPicker value="done" onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Estado: Hecho/i })).toBeInTheDocument();
  });

  it('closes on Escape', () => {
    render(<StatusPicker value="todo" onChange={vi.fn()} label="Estado" />);
    fireEvent.click(screen.getByRole('button', { name: /Estado/i }));
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});
