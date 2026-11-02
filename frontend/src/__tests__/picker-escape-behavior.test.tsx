import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import FontPicker from '../components/canvas/editor/FontPicker';
import ColorSwatchPicker from '../components/espacios/components/ColorSwatchPicker';
import SelectPicker from '../components/espacios/components/filters/SelectPicker';
import StatusPicker from '../components/espacios/components/StatusPicker';
import FolioMenuSelect from '../components/padron/components/FolioMenuSelect';
import TemplatePicker from '../components/preview-panel/TemplatePicker';

const SELECT_OPTIONS = [
  { value: 'all', label: 'Todos los estados' },
  { value: 'todo', label: 'Pendiente', color: '#87909E' },
  { value: 'done', label: 'Completados', color: '#0F9D58' },
];

const TEMPLATE_OPTIONS = [
  { value: 'a.html', label: 'Plantilla A' },
  { value: 'maquina-balde.html', label: 'maquina-balde.html' },
];

const FOLIO_OPTIONS = [
  { value: 'all', label: 'Todos los folios' },
  { value: 'mine', label: 'Mis folios' },
];

interface EscapeCase {
  name: string;
  role: 'listbox' | 'dialog';
  /** Mirrors `stopEscapePropagation: true` passed to useAnchoredPopover. */
  stopEscapePropagation?: boolean;
  mountAndOpen: () => void;
}

const CASES: EscapeCase[] = [
  {
    name: 'StatusPicker',
    role: 'listbox',
    mountAndOpen: () => {
      render(<StatusPicker value="todo" onChange={vi.fn()} label="Estado" />);
      fireEvent.click(screen.getByRole('button', { name: /Estado/i }));
    },
  },
  {
    name: 'SelectPicker',
    role: 'listbox',
    mountAndOpen: () => {
      render(
        <SelectPicker
          value="all"
          options={SELECT_OPTIONS}
          onChange={vi.fn()}
          aria-label="Estado"
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: /Estado/i }));
    },
  },
  {
    name: 'TemplatePicker (stopEscapePropagation)',
    role: 'listbox',
    stopEscapePropagation: true,
    mountAndOpen: () => {
      render(
        <TemplatePicker
          value=""
          options={TEMPLATE_OPTIONS}
          onChange={vi.fn()}
          placeholder="-- Elegir Plantilla --"
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: /Elegir plantilla/i }));
    },
  },
  {
    name: 'ColorSwatchPicker',
    role: 'dialog',
    mountAndOpen: () => {
      render(<ColorSwatchPicker color="#10b981" label="SJL" onChange={vi.fn()} />);
      fireEvent.click(screen.getByRole('button', { name: /Cambiar color de SJL/i }));
    },
  },
  {
    name: 'FontPicker',
    role: 'listbox',
    mountAndOpen: () => {
      render(<FontPicker value="Arial, sans-serif" onChange={vi.fn()} />);
      fireEvent.click(screen.getByRole('button', { name: 'Familia de fuente' }));
    },
  },
  {
    name: 'FolioMenuSelect (stopEscapePropagation)',
    role: 'listbox',
    stopEscapePropagation: true,
    mountAndOpen: () => {
      render(
        <FolioMenuSelect
          value="all"
          options={FOLIO_OPTIONS}
          onChange={vi.fn()}
          aria-label="Orden de folios"
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: /Orden de folios/i }));
    },
  },
];

describe('picker popovers close on Escape', () => {
  it.each(CASES)(
    '$name closes on Escape',
    ({ role, stopEscapePropagation, mountAndOpen }) => {
      mountAndOpen();
      expect(screen.getByRole(role)).toBeInTheDocument();

      const onOuterKeyDown = vi.fn();
      document.addEventListener('keydown', onOuterKeyDown);
      try {
        fireEvent.keyDown(document, { key: 'Escape' });
      } finally {
        document.removeEventListener('keydown', onOuterKeyDown);
      }

      expect(screen.queryByRole(role)).not.toBeInTheDocument();
      if (stopEscapePropagation) {
        expect(onOuterKeyDown).not.toHaveBeenCalled();
      } else {
        expect(onOuterKeyDown).toHaveBeenCalledTimes(1);
      }
    },
  );
});
