import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import DatePicker from './DatePicker';

describe('Volantes DatePicker', () => {
  it('keeps the compact month grid and emits a local ISO date', () => {
    const onChange = vi.fn();
    render(<DatePicker value="2026-09-01" onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: '01/09/2026' }));
    const dayButtons = screen.getAllByRole('button').filter((button) => /^\d{1,2}$/.test(button.textContent || ''));
    expect(dayButtons).toHaveLength(30);

    fireEvent.click(screen.getByRole('button', { name: '2' }));
    expect(onChange).toHaveBeenCalledWith('2026-09-02');
    expect(screen.queryByRole('dialog', { name: 'Elegir fecha' })).toBeNull();
  });
});
