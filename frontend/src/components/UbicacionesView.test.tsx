import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ResultPanel } from './UbicacionesView';

const outputDir = 'C:\\salida';

describe('UbicacionesView ResultPanel', () => {
  it('shows the success panel without a fallidos note when none failed', () => {
    render(<ResultPanel result={{ success: true, data: { generados: 5, fallidos: 0, consolidado: false } }} outputDir={outputDir} />);
    expect(screen.getByText('Proceso completado')).toBeInTheDocument();
    expect(screen.getByText('5 PDFs')).toBeInTheDocument();
    expect(screen.queryByText(/omitida/)).not.toBeInTheDocument();
  });

  it('surfaces fallidos as an amber note when some rows failed', () => {
    render(<ResultPanel result={{ success: true, data: { generados: 3, fallidos: 2, consolidado: false } }} outputDir={outputDir} />);
    expect(screen.getByText('3 PDFs')).toBeInTheDocument();
    expect(screen.getByText('2 filas omitidas por error')).toBeInTheDocument();
  });

  it('singularizes the fallidos note for a single failure', () => {
    render(<ResultPanel result={{ success: true, data: { generados: 4, fallidos: 1, consolidado: false } }} outputDir={outputDir} />);
    expect(screen.getByText('1 fila omitida por error')).toBeInTheDocument();
  });

  it('does not show a green check when every row failed', () => {
    render(<ResultPanel result={{ success: true, data: { generados: 0, fallidos: 5, consolidado: false } }} outputDir={outputDir} />);
    expect(screen.getByText('Proceso completado con errores')).toBeInTheDocument();
    expect(screen.getByText('0 PDFs')).toBeInTheDocument();
    expect(screen.getByText('5 filas omitidas por error')).toBeInTheDocument();
    expect(screen.queryByText('Proceso completado')).not.toBeInTheDocument();
  });

  it('shows the consolidado wording with page count', () => {
    render(<ResultPanel result={{ success: true, data: { generados: 4, fallidos: 0, consolidado: true } }} outputDir={outputDir} />);
    expect(screen.getByText('1 PDF consolidado')).toBeInTheDocument();
    expect(screen.getByText('4 páginas')).toBeInTheDocument();
  });
});
