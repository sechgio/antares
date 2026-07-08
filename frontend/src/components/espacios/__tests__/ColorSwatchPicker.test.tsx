import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ColorSwatchPicker from '../components/ColorSwatchPicker';
import { ESPACIOS_COLORS } from '../utils/colors';

describe('ColorSwatchPicker', () => {
  it('opens palette and selects a preset color', () => {
    const onChange = vi.fn();
    render(<ColorSwatchPicker color={ESPACIOS_COLORS[0]} label="CHORRILLOS" onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: /Cambiar color de CHORRILLOS/i }));

    const dialog = screen.getByRole('dialog', { name: /Paleta de color para CHORRILLOS/i });
    expect(dialog).toBeInTheDocument();
    // Panel is portaled to document.body (escapes sidebar overflow).
    expect(dialog.parentElement).toBe(document.body);

    fireEvent.click(screen.getByRole('button', { name: `Color ${ESPACIOS_COLORS[1]}` }));
    expect(onChange).toHaveBeenCalledWith(ESPACIOS_COLORS[1]);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('applies custom color from native input', () => {
    const onChange = vi.fn();
    render(<ColorSwatchPicker color="#10b981" label="CHORRILLOS" onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: /Cambiar color de CHORRILLOS/i }));
    const input = screen.getByLabelText(/Color personalizado para CHORRILLOS/i);
    fireEvent.change(input, { target: { value: '#ff00aa' } });
    expect(onChange).toHaveBeenCalledWith('#ff00aa');
  });

  it('closes on Escape', () => {
    render(<ColorSwatchPicker color="#10b981" label="SJL" onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Cambiar color de SJL/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
