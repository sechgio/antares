import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import RenameCard from './RenameCard';

const baseProps = {
  files: ['C:\\fotos\\IMG-001.jpg'],
  usarRename: true,
  onNamingModeChange: vi.fn(),
  patron: '{codigo}_{nombre}{ext}',
  onPatronChange: vi.fn(),
  secuencia: 1,
  onSecuenciaChange: vi.fn(),
  useFilenameSeq: true,
  onToggleFilenameSeq: vi.fn(),
  fields: ['codigo', 'nombre'],
  dbColumns: ['codigo', 'nombre'],
  dbRecords: [{ codigo: 'IMG-001', nombre: 'Casa matriz' }],
  onInsertVar: vi.fn(),
  keyColumn: 'codigo',
  onKeyColumnChange: vi.fn(),
};

describe('RenameCard', () => {
  it('keeps selected rename columns synchronized with the current database columns', async () => {
    const onPatronChange = vi.fn();
    const { rerender } = render(<RenameCard {...baseProps} onPatronChange={onPatronChange} />);

    expect(screen.getByRole('button', { name: 'codigo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'nombre' })).toBeInTheDocument();

    rerender(
      <RenameCard
        {...baseProps}
        dbColumns={['archivo', 'cliente']}
        dbRecords={[{ archivo: 'IMG-001.jpg', cliente: 'Cliente Norte' }]}
        keyColumn="archivo"
        onPatronChange={onPatronChange}
      />
    );

    expect(screen.queryByRole('button', { name: 'codigo' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'archivo' })).toBeInTheDocument();
    await waitFor(() => {
      expect(onPatronChange).toHaveBeenCalledWith('{archivo}_{cliente}{ext}');
    });
  });

  it('uses database columns in the advanced variable inserter when a database is loaded', () => {
    const onInsertVar = vi.fn();
    render(
      <RenameCard
        {...baseProps}
        dbColumns={['archivo', 'cliente']}
        dbRecords={[{ archivo: 'IMG-001.jpg', cliente: 'Cliente Norte' }]}
        onInsertVar={onInsertVar}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Editor avanzado/i }));
    fireEvent.click(screen.getByRole('button', { name: '{cliente}' }));

    expect(onInsertVar).toHaveBeenCalledWith('{cliente}');
  });

  it('preserves the detected separator when resynchronizing a stale pattern', async () => {
    const onPatronChange = vi.fn();
    const { rerender } = render(
      <RenameCard
        {...baseProps}
        patron="{codigo}-{nombre}{ext}"
        onPatronChange={onPatronChange}
      />
    );

    rerender(
      <RenameCard
        {...baseProps}
        patron="{codigo}-{nombre}{ext}"
        dbColumns={['archivo', 'cliente']}
        dbRecords={[{ archivo: 'IMG-001.jpg', cliente: 'Cliente Norte' }]}
        keyColumn="archivo"
        onPatronChange={onPatronChange}
      />
    );

    await waitFor(() => {
      expect(onPatronChange).toHaveBeenCalledWith('{archivo}-{cliente}{ext}');
    });
  });

  it('shows separator controls when the custom pattern uses {sep}', () => {
    const onWordSeparatorChange = vi.fn();
    render(
      <RenameCard
        {...baseProps}
        dbColumns={[]}
        dbRecords={[]}
        patron="{sgio}{sep}{seq}{ext}"
        wordSeparator="_"
        onWordSeparatorChange={onWordSeparatorChange}
      />
    );

    expect(screen.getByText('Separador')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Guion medio/i }));
    expect(onWordSeparatorChange).toHaveBeenCalledWith('-');

    fireEvent.click(screen.getByRole('button', { name: /Editor avanzado/i }));
    expect(screen.getByRole('button', { name: '{sep}' })).toBeInTheDocument();
  });

  it('presents the enabled sequence as per database row', () => {
    render(<RenameCard {...baseProps} patron="{sgio}_{seq}{ext}" />);
    expect(screen.getByText('Por fila de BD')).toBeInTheDocument();
    expect(screen.getByText('Cada fila comienza en 001')).toBeInTheDocument();
    expect(screen.queryByText('Desde archivo')).not.toBeInTheDocument();
  });
});
