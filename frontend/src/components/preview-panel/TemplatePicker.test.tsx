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
});
