import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { OperationSection, SettingSwitch, SettingSwitchRow } from './ui';

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

describe('SettingSwitch', () => {
  it('exposes switch semantics and toggles on click', () => {
    const onChange = vi.fn();

    render(
      <SettingSwitch
        checked={false}
        onChange={onChange}
        aria-label="Omitir compresion"
      />
    );

    const toggle = screen.getByRole('switch', { name: 'Omitir compresion' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');

    fireEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('reflects checked state', () => {
    render(
      <SettingSwitch
        checked
        onChange={vi.fn()}
        aria-label="Excluir del lote"
      />
    );

    expect(screen.getByRole('switch', { name: 'Excluir del lote' })).toHaveAttribute('aria-checked', 'true');
  });
});

describe('SettingSwitchRow', () => {
  it('associates label with switch and forwards toggle changes', () => {
    const onChange = vi.fn();

    render(
      <SettingSwitchRow
        switchId="exclude-switch"
        label="Excluir del lote"
        checked={false}
        onChange={onChange}
        accentColor="#EF4444"
      />
    );

    fireEvent.click(screen.getByRole('switch', { name: 'Excluir del lote' }));
    expect(onChange).toHaveBeenCalledWith(true);
    expect(screen.getByText('Excluir del lote')).toHaveAttribute('for', 'exclude-switch');
  });
});
