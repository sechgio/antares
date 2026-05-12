import { describe, expect, it } from 'vitest';
import {
  OUTPUT_FORMAT_OPTIONS,
  createDefaultHeaderData,
  createDefaultWaterCutData,
  createInitialWaterCutItems,
} from './data';

describe('padron output format data', () => {
  it('keeps the existing padron template as the default output format', () => {
    expect(OUTPUT_FORMAT_OPTIONS[0]).toMatchObject({
      value: 'service-interruption',
      label: 'Plantilla actual',
    });
    expect(createDefaultHeaderData()).toMatchObject({
      centro: 'San Juan de Lurigancho',
      servicioAfectado: 'Agua Potable',
      motivoInterrupcion: 'Limpieza y desinfección de Reservorio',
    });
  });

  it('defines an independent water cut notice configuration', () => {
    expect(OUTPUT_FORMAT_OPTIONS).toContainEqual({
      value: 'water-cut-notice',
      label: 'Aviso corte de agua',
      rowsPerPage: 36,
    });
    expect(createDefaultWaterCutData()).toEqual({
      cuadranteAfectado: '',
      fechaCorte: '',
      horarioCorte: '',
      motivo: '',
    });
  });

  it('creates water cut notice rows with their own columns', () => {
    expect(createInitialWaterCutItems(2)).toEqual([
      {
        item: 1,
        hora: '',
        fecha: '',
        nombresApellidos: '',
        direccion: '',
        dni: '',
        firma: '',
        observaciones: '',
      },
      {
        item: 2,
        hora: '',
        fecha: '',
        nombresApellidos: '',
        direccion: '',
        dni: '',
        firma: '',
        observaciones: '',
      },
    ]);
  });

  it('defaults the water cut notice to 36 printable rows', () => {
    expect(createInitialWaterCutItems()).toHaveLength(36);
  });
});
