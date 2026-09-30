import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Button from '../ui/Button';

describe('Button', () => {
  it('forwards native accessibility and DOM attributes', () => {
    render(
      <Button aria-label="Guardar" aria-pressed data-testid="save-button">
        Guardar
      </Button>,
    );

    const button = screen.getByTestId('save-button');
    expect(button).toHaveAttribute('aria-label', 'Guardar');
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(button).toHaveAttribute('data-slot', 'button');
    expect(button).toHaveClass('focus-visible:ring-2');
  });
});
