import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import CommandPalette, { type CanvasCommand } from '../editor/CommandPalette';

const commands: CanvasCommand[] = [
  { id: 'undo', label: 'Deshacer', hint: 'Ctrl+Z', group: 'Editar' },
  { id: 'copy', label: 'Copiar', hint: 'Ctrl+C', group: 'Editar', disabled: true },
  { id: 'zoom:fit', label: 'Ajustar a la vista', hint: 'Shift+1', group: 'Vista' },
  { id: 'tool:text', label: 'Texto', hint: 'T', group: 'Herramientas', keywords: 'escribir letra' },
];

describe('CommandPalette', () => {
  it('lists commands and runs the active one on Enter', () => {
    const onRun = vi.fn();
    render(<CommandPalette commands={commands} onRun={onRun} onClose={vi.fn()} />);
    const input = screen.getByLabelText('Buscar acción');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onRun).toHaveBeenCalledWith('undo');
  });

  it('filters by label and keywords', () => {
    render(<CommandPalette commands={commands} onRun={vi.fn()} onClose={vi.fn()} />);
    const input = screen.getByLabelText('Buscar acción');
    fireEvent.change(input, { target: { value: 'letra' } });
    expect(screen.queryByRole('option', { name: /Texto/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Deshacer/ })).toBeNull();
  });

  it('navigates with arrows skipping disabled commands', () => {
    const onRun = vi.fn();
    render(<CommandPalette commands={commands} onRun={onRun} onClose={vi.fn()} />);
    const input = screen.getByLabelText('Buscar acción');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    // 'copy' is disabled, so second runnable is zoom:fit
    expect(onRun).toHaveBeenCalledWith('zoom:fit');
  });

  it('closes on Escape and reports empty results', () => {
    const onClose = vi.fn();
    render(<CommandPalette commands={commands} onRun={vi.fn()} onClose={onClose} />);
    const input = screen.getByLabelText('Buscar acción');
    fireEvent.change(input, { target: { value: 'zzz' } });
    expect(screen.getByText(/Sin resultados/)).toBeInTheDocument();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
