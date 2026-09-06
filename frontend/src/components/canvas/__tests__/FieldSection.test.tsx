import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createLayer } from '../constants';
import FieldSection from '../editor/panels/tails/FieldSection';
import type { SectionProps } from '../editor/panels/types';

function renderField(overrides: Partial<SectionProps> = {}) {
  const layer = createLayer('field', {
    name: 'Distrito',
    meta: { key: 'DISTRITO', fallback: '-' },
  });
  const props = {
    layer,
    onChange: vi.fn(),
    emitLive: vi.fn(),
    onCommitLive: vi.fn(),
    ...overrides,
  } as SectionProps;
  return { layer, ...render(<FieldSection {...props} />), props };
}

describe('FieldSection', () => {
  it('presents suggested bindings as selectable chips', () => {
    renderField();

    expect(screen.getByRole('group', { name: 'Campos sugeridos' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Distrito (DISTRITO)' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'NIS (NIS)' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('keeps quick binding and custom key editing connected to the layer callbacks', () => {
    const onChange = vi.fn();
    const emitLive = vi.fn();
    renderField({ onChange, emitLive });

    fireEvent.click(screen.getByRole('button', { name: 'NIS (NIS)' }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'NIS', meta: expect.objectContaining({ key: 'NIS' }) }),
    );

    fireEvent.change(screen.getByTestId('canvas-field-key-input'), { target: { value: 'direccion afectada' } });
    expect(emitLive).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'DIRECCION_AFECTADA', meta: expect.objectContaining({ key: 'DIRECCION_AFECTADA' }) }),
    );
  });
});
