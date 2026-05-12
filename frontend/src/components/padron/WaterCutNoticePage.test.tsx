import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createInitialWaterCutItems } from './data';
import WaterCutNoticePage from './WaterCutNoticePage';

describe('WaterCutNoticePage', () => {
  it('renders the aviso de corte layout from the PDF model', () => {
    const items = createInitialWaterCutItems().map((item, index) => (
      index === 0
        ? {
            ...item,
            hora: '08:10',
            fecha: '09/05/2026',
            nombresApellidos: 'Maria Perez',
            direccion: 'Av. Lima 123',
            dni: '12345678',
            observaciones: 'Notificado',
          }
        : item
    ));

    render(
      <WaterCutNoticePage
        headerData={{
          cuadranteAfectado: 'Sector 12',
          fechaCorte: '09/05/2026',
          horarioCorte: '08:00 a 18:00',
          motivo: 'Trabajos de mejoramiento',
        }}
        items={items}
        sedapalLogo="sedapal.png"
        pageNumber={1}
        totalPages={1}
      />,
    );

    expect(screen.getByRole('heading', { name: /AVISO DE CORTE DEL SERVICIO DE AGUA POTABLE/i })).toBeInTheDocument();
    expect(screen.getByText('CUADRANTE AFECTADO:')).toBeInTheDocument();
    expect(screen.getByText('Sector 12')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'DNI' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'OBSERVACIONES' })).toBeInTheDocument();
    expect(screen.getByText('Maria Perez')).toBeInTheDocument();
    expect(screen.getByText('Página 1 de 1')).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(37);
  });

  it('does not pad overflow pages to a full sheet', () => {
    render(
      <WaterCutNoticePage
        headerData={{
          cuadranteAfectado: 'Sector 12',
          fechaCorte: '09/05/2026',
          horarioCorte: '08:00 a 18:00',
          motivo: 'Trabajos de mejoramiento',
        }}
        items={[
          {
            item: 37,
            hora: '11:20',
            fecha: '09/05/2026',
            nombresApellidos: 'Registro final',
            direccion: 'Jr. Cusco 456',
            dni: '87654321',
            firma: '',
            observaciones: '',
          },
        ]}
        sedapalLogo="sedapal.png"
        pageNumber={2}
        totalPages={2}
        rowsPerPage={39}
      />,
    );

    expect(screen.getByText('Registro final')).toBeInTheDocument();
    expect(screen.getByText('Página 2 de 2')).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(2);
  });
});
