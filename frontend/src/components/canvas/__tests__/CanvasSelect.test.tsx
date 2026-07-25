import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CanvasSelect from '../editor/CanvasSelect';

describe('CanvasSelect', () => {
  const options = [
    { value: 'doc-1', label: 'Certificados' },
    { value: 'doc-2', label: 'Sin título' },
  ];

  it('renders selected label correctly', () => {
    render(
      <CanvasSelect
        value="doc-1"
        onChange={vi.fn()}
        options={options}
        aria-label="Archivo abierto"
      />
    );

    expect(screen.getByRole('button', { name: 'Archivo abierto' })).toHaveTextContent('Certificados');
  });

  it('opens dropdown popover on click and selects option', () => {
    const handleChange = vi.fn();
    render(
      <CanvasSelect
        value="doc-1"
        onChange={handleChange}
        options={options}
        aria-label="Archivo abierto"
      />
    );

    const button = screen.getByRole('button', { name: 'Archivo abierto' });
    fireEvent.click(button);

    // Option list should be visible
    const optionBtn = screen.getByRole('button', { name: 'Sin título' });
    expect(optionBtn).toBeInTheDocument();

    fireEvent.click(optionBtn);
    expect(handleChange).toHaveBeenCalledWith('doc-2');
  });

  it('closes popover when pressing Escape', () => {
    render(
      <CanvasSelect
        value="doc-1"
        onChange={vi.fn()}
        options={options}
        aria-label="Archivo abierto"
      />
    );

    const button = screen.getByRole('button', { name: 'Archivo abierto' });
    fireEvent.click(button);

    expect(screen.getByRole('button', { name: 'Sin título' })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('button', { name: 'Sin título' })).not.toBeInTheDocument();
  });
});
