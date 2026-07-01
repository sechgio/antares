import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import TemplateSelector from './TemplateSelector';

describe('TemplateSelector', () => {
  it('renders aviso corte ad as the available template', () => {
    render(<TemplateSelector value="aviso-corte-ad" onChange={() => {}} />);
    expect(screen.getByRole('combobox', { name: 'Plantilla de salida' })).toHaveValue('aviso-corte-ad');
    expect(screen.getByRole('option', { name: 'aviso corte ad' })).toBeInTheDocument();
  });

  it('calls onChange when a template is selected', () => {
    const onChange = vi.fn();
    render(<TemplateSelector value="aviso-corte-ad" onChange={onChange} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Plantilla de salida' }), {
      target: { value: 'aviso-corte-ad' },
    });
    expect(onChange).toHaveBeenCalledWith('aviso-corte-ad');
  });
});