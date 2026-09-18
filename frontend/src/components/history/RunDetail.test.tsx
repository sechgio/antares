import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import RunDetail from './RunDetail';
import type { HistoryRunRow } from './runTypes';

function makeRun(overrides: Partial<HistoryRunRow> = {}): HistoryRunRow {
  return {
    id: 42,
    run_type: 'conversion',
    timestamp: '2025-01-15T10:30:00',
    formato: 'webp',
    calidad: 80,
    ok_count: 8,
    err_count: 2,
    patron: '{n}_{seq}',
    files_json: JSON.stringify(['C:\\a.jpg', 'C:\\b.png']),
    options_json: JSON.stringify({ formato: 'webp', calidad: 80 }),
    ...overrides,
  };
}

describe('RunDetail', () => {
  it('muestra tasa de éxito y conteos', () => {
    render(<RunDetail run={makeRun()} onReexecute={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText('Tasa de éxito')).toBeInTheDocument();
    expect(screen.getAllByText('80%').length).toBeGreaterThan(0);
  });

  it('lista los archivos por nombre base', () => {
    render(<RunDetail run={makeRun()} onReexecute={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText('a.jpg')).toBeInTheDocument();
    expect(screen.getByText('b.png')).toBeInTheDocument();
  });

  it('tolera JSON corrupto en files/options', () => {
    render(
      <RunDetail
        run={makeRun({ files_json: '{mal', options_json: 'no-json' })}
        onReexecute={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByText('Tasa de éxito')).toBeInTheDocument();
  });

  it('propaga reexecute y delete', () => {
    const onReexecute = vi.fn();
    const onDelete = vi.fn();
    render(<RunDetail run={makeRun()} onReexecute={onReexecute} onDelete={onDelete} />);
    fireEvent.click(screen.getByText(/Reejecutar|Re-ejecutar/i));
    fireEvent.click(screen.getByText(/Eliminar/i));
    expect(onReexecute).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('100% cuando no hay errores', () => {
    render(<RunDetail run={makeRun({ err_count: 0 })} onReexecute={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText('100%')).toBeInTheDocument();
  });
});
