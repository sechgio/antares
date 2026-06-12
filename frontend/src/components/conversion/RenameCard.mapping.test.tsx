import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import RenameCard from './RenameCard';

const baseProps = {
  files: ['C:\\fotos\\IMG_0001.jpg', 'C:\\fotos\\IMG_0002.jpg'],
  usarRename: true,
  mappingMode: true,
  namingMode: 'custom',
  onNamingModeChange: vi.fn(),
  patron: '{renombre}{ext}',
  onPatronChange: vi.fn(),
  secuencia: 1,
  onSecuenciaChange: vi.fn(),
  useFilenameSeq: true,
  onToggleFilenameSeq: vi.fn(),
  namingPresets: [],
  fields: ['codigo', 'nombre'],
  dbColumns: [],
  dbRecords: [],
  onInsertVar: vi.fn(),
  keyColumn: '',
  onKeyColumnChange: vi.fn(),
  mappingResult: {
    mapping: {
      'IMG_0001.jpg': 'fachada_norte',
      'IMG_0002.jpg': 'fachada_sur',
      'IMG_0003.jpg': 'sin_archivo',
    },
    totalEntries: 3,
    matchedFiles: 2,
    unmatchedFiles: [],
    orphanEntries: ['IMG_0003.jpg'],
    collisions: [],
  },
};

describe('RenameCard mapping mode', () => {
  it('renders direct mapping section and hides steps 2-3', () => {
    render(<RenameCard {...baseProps} />);

    expect(screen.getByText('Mapeo directo activo')).toBeInTheDocument();
    expect(screen.queryByText('¿Qué columnas quieres en el nuevo nombre?')).not.toBeInTheDocument();
    expect(screen.queryByText('¿Cómo quieres separar las palabras?')).not.toBeInTheDocument();
  });

  it('renders classic UI for multi-column databases', () => {
    render(
      <RenameCard
        {...baseProps}
        mappingMode={false}
        dbColumns={['codigo', 'nombre', 'categoria']}
        mappingResult={null}
        keyColumn="codigo"
      />
    );

    expect(screen.queryByText('Mapeo directo activo')).not.toBeInTheDocument();
    expect(screen.getByText('¿Qué columnas quieres en el nuevo nombre?')).toBeInTheDocument();
    expect(screen.getByText('¿Cómo quieres separar las palabras?')).toBeInTheDocument();
  });

  it('shows first 10 rows and ver todas link', () => {
    const manyEntries = Object.fromEntries(
      Array.from({ length: 12 }, (_, idx) => [`IMG_${String(idx + 1).padStart(4, '0')}.jpg`, `dest_${idx + 1}`])
    );
    render(
      <RenameCard
        {...baseProps}
        mappingResult={{
          mapping: manyEntries,
          totalEntries: 12,
          matchedFiles: 12,
          unmatchedFiles: [],
          orphanEntries: [],
          collisions: [],
        }}
      />
    );

    expect(screen.getByText('Ver todas (12)')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Ver todas (12)'));
    expect(screen.getByText('Ver menos')).toBeInTheDocument();
  });

  it('shows collision warning when outputs collide', () => {
    render(
      <RenameCard
        {...baseProps}
        mappingResult={{
          ...baseProps.mappingResult,
          collisions: [{ output: 'mismo.jpg', sources: ['A.jpg', 'B.jpg'] }],
        }}
      />
    );

    expect(screen.getByText(/Varios archivos quedarían con el mismo nombre/)).toBeInTheDocument();
    expect(screen.getByText(/mismo.jpg ← A.jpg, B.jpg/)).toBeInTheDocument();
  });
});
