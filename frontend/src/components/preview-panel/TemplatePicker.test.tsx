import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import TemplatePicker from './TemplatePicker';

const OPTIONS = [
  { value: 'a.html', label: 'Plantilla A' },
  { value: 'b.html', label: 'Plantilla B' },
  { value: 'maquina-balde.html', label: 'maquina-balde.html' },
];

describe('TemplatePicker', () => {
  it('opens Apple-style options and selects a template', () => {
    const onChange = vi.fn();
    render(
      <TemplatePicker
        value=""
        options={OPTIONS}
        onChange={onChange}
        placeholder="-- Elegir Plantilla --"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Elegir plantilla/i }));
    const listbox = screen.getByRole('listbox');
    expect(listbox).toBeInTheDocument();
    expect(listbox.parentElement).toBe(document.body);

    fireEvent.click(screen.getByRole('option', { name: /maquina-balde.html/i }));
    expect(onChange).toHaveBeenCalledWith('maquina-balde.html');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('shows the selected label on the trigger', () => {
    render(
      <TemplatePicker
        value="b.html"
        options={OPTIONS}
        onChange={vi.fn()}
        placeholder="-- Elegir Plantilla --"
      />,
    );
    expect(screen.getByRole('button', { name: /Elegir plantilla/i })).toHaveTextContent('Plantilla B');
  });

  it('closes on Escape', () => {
    render(
      <TemplatePicker
        value=""
        options={OPTIONS}
        onChange={vi.fn()}
        placeholder="-- Elegir Plantilla --"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Elegir plantilla/i }));
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('positions a capped menu next to the trigger, not pinned to the window top', () => {
    const onChange = vi.fn();
    const manyOptions = Array.from({ length: 74 }, (_, i) => ({
      value: `id-${i}`,
      label: `${i + 1}. id-${i}`,
    }));

    const origGetRect = Element.prototype.getBoundingClientRect;
    const offsetHeightDesc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
    Element.prototype.getBoundingClientRect = function () {
      return { top: 600, bottom: 624, left: 20, right: 220, width: 200, height: 24, x: 20, y: 600, toJSON: () => ({}) };
    };
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 1500 });

    try {
      render(
        <TemplatePicker
          value=""
          options={manyOptions}
          onChange={onChange}
          placeholder="-- Seleccionar Fila --"
          aria-label="Elegir fila"
          maxMenuHeight={280}
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: /elegir fila/i }));
      const listbox = screen.getByRole('listbox');
      expect(listbox.style.top).toBe('316px');
      expect(listbox.style.maxHeight).toBe('280px');
    } finally {
      Element.prototype.getBoundingClientRect = origGetRect;
      if (offsetHeightDesc) {
        Object.defineProperty(HTMLElement.prototype, 'offsetHeight', offsetHeightDesc);
      } else {
        delete (HTMLElement.prototype as unknown as { offsetHeight?: unknown }).offsetHeight;
      }
    }
  });
});
