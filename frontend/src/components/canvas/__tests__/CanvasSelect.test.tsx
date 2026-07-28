import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
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

    expect(screen.getByRole('button', { name: /Certificados/i })).toHaveTextContent('Certificados');
    expect(screen.getByLabelText('Archivo abierto')).toBeInTheDocument();
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

    const button = screen.getByRole('button', { name: /Certificados/i });
    fireEvent.click(button);

    const listbox = screen.getByRole('listbox');
    const optionBtn = within(listbox).getByRole('option', { name: 'Sin título' });
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

    const button = screen.getByRole('button', { name: /Certificados/i });
    fireEvent.click(button);

    expect(within(screen.getByRole('listbox')).getByRole('option', { name: 'Sin título' })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('renders all options in a portal listbox', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      value: `col-${i}`,
      label: `Columna ${i}`,
    }));
    render(
      <CanvasSelect
        value="col-0"
        onChange={vi.fn()}
        options={many}
        aria-label="Columnas"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Columna 0/i }));
    const listbox = screen.getByRole('listbox');
    expect(listbox).toBeInTheDocument();
    expect(within(listbox).getByRole('option', { name: 'Columna 11' })).toBeInTheDocument();
    expect(document.body.contains(listbox)).toBe(true);
  });

  it('portals the menu into .canvas-app so --cv-* tokens still apply', () => {
    const { container } = render(
      <div className="canvas-app">
        <CanvasSelect
          value="doc-1"
          onChange={vi.fn()}
          options={options}
          aria-label="Archivo abierto"
        />
      </div>,
    );

    fireEvent.click(screen.getByRole('button', { name: /Certificados/i }));
    const listbox = screen.getByRole('listbox');
    const canvasApp = container.querySelector('.canvas-app');
    expect(canvasApp).toBeTruthy();
    expect(canvasApp!.contains(listbox)).toBe(true);
    expect(listbox.parentElement).toBe(canvasApp);
  });
});
