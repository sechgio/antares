import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { OperationSection } from './ui';

describe('OperationSection', () => {
  it('does not shrink inside the optimizer settings scroll column', () => {
    render(
      <OperationSection
        title="Recorte"
        icon={<span aria-hidden="true">Icon</span>}
        accentColor="#8B5CF6"
        enabled
        onToggle={vi.fn()}
      >
        <label>
          Relacion
          <select defaultValue="original">
            <option value="original">Original</option>
          </select>
        </label>
        <button>Ajustar recorte activo</button>
      </OperationSection>
    );

    const section = screen.getAllByRole('button', { name: /Recorte/i })[0].parentElement;

    expect(section).toHaveClass('shrink-0');
  });
});
