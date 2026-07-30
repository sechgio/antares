import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import FontPicker from '../editor/FontPicker';

describe('FontPicker', () => {
  it('renders selected font label', () => {
    render(
      <FontPicker
        value="Segoe UI, Arial, sans-serif"
        onChange={vi.fn()}
        aria-label="Familia de fuente"
      />,
    );
    expect(screen.getByRole('button', { name: 'Familia de fuente' })).toHaveTextContent('Segoe UI');
  });

  it('opens menu and selects a google font stack', () => {
    const onChange = vi.fn();
    render(
      <div className="canvas-app">
        <FontPicker value="Segoe UI, Arial, sans-serif" onChange={onChange} />
      </div>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Familia de fuente' }));
    const listbox = screen.getByRole('listbox');
    fireEvent.click(within(listbox).getByRole('option', { name: 'Inter' }));
    expect(onChange).toHaveBeenCalledWith("'Inter', sans-serif");
  });

  it('filters fonts by search query', () => {
    render(<FontPicker value="Arial, sans-serif" onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Familia de fuente' }));
    const search = screen.getByLabelText('Buscar fuente');
    fireEvent.change(search, { target: { value: 'JetBrains' } });
    const listbox = screen.getByRole('listbox');
    expect(within(listbox).getByRole('option', { name: 'JetBrains Mono' })).toBeInTheDocument();
    expect(within(listbox).queryByRole('option', { name: 'Inter' })).not.toBeInTheDocument();
  });

  it('closes on Escape', () => {
    render(<FontPicker value="Arial, sans-serif" onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Familia de fuente' }));
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('opens beside the trigger (left when space allows), not below', () => {
    // Place trigger on the right so the menu prefers the left (Figma-style).
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value() {
        return {
          top: 120,
          bottom: 148,
          left: 900,
          right: 1100,
          width: 200,
          height: 28,
          x: 900,
          y: 120,
          toJSON() {
            return {};
          },
        };
      },
    });

    render(
      <div className="canvas-app">
        <FontPicker value="Segoe UI, Arial, sans-serif" onChange={vi.fn()} />
      </div>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Familia de fuente' }));
    const listbox = screen.getByRole('listbox');
    expect(listbox).toHaveAttribute('data-placement', 'side');
    const left = Number.parseFloat(listbox.style.left);
    expect(left).toBeLessThan(900);
    expect(listbox.style.background).toMatch(/#fff|#ffffff|rgb\(255,\s*255,\s*255\)/i);
  });
});
