import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import PreviewPanel from './PreviewPanel';
import { createEmptyClientReport } from './testFixtures';

describe('Informes v2 PreviewPanel', () => {
  it('renders header fields and 3x2 photo grid', () => {
    const report = createEmptyClientReport(1);
    report.header.estacion = 'R 900 Elevado';
    report.header.distrito = 'Villa El Salvador';
    const photos = [
      { name: 'R-900-1.jpg', src: 'data:image/png;base64,a' },
      { name: 'R-900-2.jpg', src: 'data:image/png;base64,b' },
    ];

    render(<PreviewPanel report={report} logoLeft={null} logoRight={null} photos={photos} />);

    expect(screen.getByTestId('iv2-preview')).toBeInTheDocument();
    expect(screen.getByText(/R 900 Elevado/)).toBeInTheDocument();
    expect(screen.getByText(/DISTRITO:/)).toBeInTheDocument();
    expect(screen.getAllByText(/Villa El Salvador/).length).toBeGreaterThan(0);
    const grid = screen.getByTestId('iv2-photo-grid');
    expect(grid.children).toHaveLength(6);
    expect(grid.querySelectorAll('img')).toHaveLength(2);
  });

  it('renders blank template when report is null', () => {
    render(<PreviewPanel report={null} logoLeft={null} logoRight={null} photos={[]} />);
    const paper = screen.getByTestId('iv2-preview');
    expect(paper).toHaveAttribute('data-template', 'true');
    expect(screen.getByText('Limpieza y Desinfección de Reservorios y Cisternas')).toBeInTheDocument();
    expect(screen.getByText('DIAMETRO DE VALVULAS')).toBeInTheDocument();
    expect(screen.getByText('DIAMETRO DE TUBERIA')).toBeInTheDocument();
    expect(screen.queryByText('Selecciona un informe para previsualizar')).not.toBeInTheDocument();
  });

  it('computes and renders valve totals in table', () => {
    const report = createEmptyClientReport(2);
    report.valvulas.ingreso = {
      diametros: { '2': 3, '4': 2 },
      oper: 5,
      no_op: 0,
      observaciones: 'ok',
    };
    report.valvulas.salida = {
      diametros: { '2': 1, '4': 4 },
      oper: 4,
      no_op: 1,
      observaciones: 'revisar',
    };

    render(<PreviewPanel report={report} logoLeft={null} logoRight={null} photos={[]} />);
    expect(screen.getByText('DIAMETRO DE VALVULAS')).toBeInTheDocument();
    expect(screen.getByText('DIAMETRO DE TUBERIA')).toBeInTheDocument();
  });

  it('renders the Reservorios 2 template instead of the classic one', () => {
    const report = createEmptyClientReport(3);
    report.plantilla = 'reservorios2';
    report.header.estacion = 'R 900';
    report.header.distrito = 'San Juan de Miraflores';
    report.header.fecha_ejecucion = '10/09/2026';
    report.reservorios2.inspeccion.ducto.normal = true;
    report.reservorios2.inspeccion.cerco.critico = true;
    report.reservorios2.valvulas.desague.diametros['3'] = 2;
    report.reservorios2.valvulas.bypass.diametros['3'] = 1;
    report.reservorios2.canastilla.succion.diametros['14'] = 1;
    report.reservorios2.medidas.altura_util = '2.10';
    report.reservorios2.medidas.etiqueta_altura_util = 'PROFUNDIDAD UTIL';

    render(
      <PreviewPanel
        report={report}
        logoLeft="data:image/png;base64,left"
        logoRight={null}
        photos={[{ name: 'a.jpg', src: 'data:image/png;base64,a' }]}
      />,
    );

    expect(screen.getByTestId('iv2-preview')).toBeInTheDocument();
    expect(screen.getByText('ESTRUCTURA :')).toBeInTheDocument();
    expect(screen.getByText('DISTRITO :')).toBeInTheDocument();
    expect(screen.getByText('FECHA DE EJECUCION :')).toBeInTheDocument();
    expect(screen.getByText('San Juan de Miraflores')).toBeInTheDocument();
    expect(screen.getByText('10/09/2026')).toBeInTheDocument();
    expect(screen.queryByText('CONTRATISTA :')).not.toBeInTheDocument();
    expect(screen.queryByText('CÓD. INFRAESTRUCTURA :')).not.toBeInTheDocument();
    expect(screen.getByText('DIÁMETRO DE VÁLVULAS')).toBeInTheDocument();
    expect(screen.getByText('DIÁMETRO DE CANASTILLA')).toBeInTheDocument();
    expect(screen.getByText('CRÍTICO')).toBeInTheDocument();
    expect(screen.getByText('PROFUNDIDAD UTIL')).toBeInTheDocument();
    expect(screen.queryByText('ALTURA UTIL')).not.toBeInTheDocument();
    expect(screen.getByText('2.10')).toBeInTheDocument();
    // el total de la columna 3" suma las filas de válvulas
    const valvulasTable = screen.getByText('DIÁMETRO DE VÁLVULAS').closest('table') as HTMLTableElement;
    const totalRow = valvulasTable.querySelector('.r2-total') as HTMLTableRowElement;
    expect(totalRow.querySelector('.r2-label')).toHaveTextContent('TOTAL');
    expect(totalRow.children[2]).toHaveTextContent('3');
    expect(screen.getAllByText('✓')).toHaveLength(1);
    expect(screen.getAllByText('X')).toHaveLength(1);

    const grid = screen.getByTestId('iv2-photo-grid');
    expect(grid.querySelectorAll('.iv2-photo-cell')).toHaveLength(6);
    expect(grid.querySelectorAll('img')).toHaveLength(1);
    expect(document.querySelector('.iv2-logo img')).toHaveAttribute('src', 'data:image/png;base64,left');

    // sin secciones de la plantilla clásica
    expect(screen.queryByText('DIAMETRO DE TUBERIA')).not.toBeInTheDocument();
    expect(screen.queryByText('TIRANTE DE LIMPIEZA')).not.toBeInTheDocument();
    expect(screen.queryByText(/ESTACION:/)).not.toBeInTheDocument();
  });

  it('renders imported global totals without assigning them to a row', () => {
    const report = createEmptyClientReport(4);
    report.plantilla = 'reservorios2';
    report.reservorios2.valvulas_totales = { oper: 8, no_op: 2 };
    report.reservorios2.canastilla_totales = { oper: 5, no_op: 1 };

    render(<PreviewPanel report={report} logoLeft={null} logoRight={null} photos={[]} />);

    const valves = screen.getByText('DIÁMETRO DE VÁLVULAS').closest('table') as HTMLTableElement;
    const valveRows = valves.querySelectorAll('tbody tr');
    expect(valveRows[0].children[8]).toHaveTextContent('');
    expect(valveRows[0].children[9]).toHaveTextContent('');
    expect(valves.querySelector('.r2-total')?.children[8]).toHaveTextContent('8');
    expect(valves.querySelector('.r2-total')?.children[9]).toHaveTextContent('2');

    const baskets = screen.getByText('DIÁMETRO DE CANASTILLA').closest('table') as HTMLTableElement;
    expect(baskets.querySelector('.r2-total')?.children[8]).toHaveTextContent('5');
    expect(baskets.querySelector('.r2-total')?.children[9]).toHaveTextContent('1');
  });
});
