import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ThemedSelect from './ThemedSelect';

const options = [
  { value: 'one', label: 'Uno' },
  { value: 'two', label: 'Dos' },
  { value: 'three', label: 'Tres' },
];

describe('ThemedSelect', () => {
  it('supports arrow navigation and selection from the trigger', () => {
    const onChange = vi.fn();
    render(<ThemedSelect value="one" onChange={onChange} options={options} aria-label="Cantidad" />);

    const trigger = screen.getByRole('button', { name: 'Cantidad' });
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    fireEvent.keyDown(trigger, { key: 'Enter' });

    expect(onChange).toHaveBeenCalledWith('two');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes with Escape without changing the value', () => {
    const onChange = vi.fn();
    render(<ThemedSelect value="one" onChange={onChange} options={options} aria-label="Cantidad" />);

    const trigger = screen.getByRole('button', { name: 'Cantidad' });
    fireEvent.click(trigger);
    fireEvent.keyDown(trigger, { key: 'Escape' });

    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(onChange).not.toHaveBeenCalled();
  });
});
