import { describe, expect, it } from 'vitest';
import {
  OUTPUT_FORMAT_OPTIONS,
  MAX_PADRON_ITEMS,
  createDefaultHeaderData,
  createDefaultWaterCutData,
  createInitialItems,
  createInitialWaterCutItems,
  normalizeItemCount,
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

  it('defines the volante lurigancho output format without changing the default', () => {
    expect(OUTPUT_FORMAT_OPTIONS[0]).toMatchObject({
      value: 'service-interruption',
      label: 'Plantilla actual',
    });
    expect(OUTPUT_FORMAT_OPTIONS).toContainEqual({
      value: 'volante-lurigancho',
      label: 'volante lurigancho',
      rowsPerPage: 18,
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

  it('keeps padron counts finite and bounded before allocating rows', () => {
    expect(normalizeItemCount(MAX_PADRON_ITEMS + 1, 36)).toBe(MAX_PADRON_ITEMS);
    expect(normalizeItemCount(Infinity, 36)).toBe(36);
    expect(normalizeItemCount(Number.NaN, 36)).toBe(36);
    expect(createInitialItems(MAX_PADRON_ITEMS + 1)).toHaveLength(MAX_PADRON_ITEMS);
    expect(createInitialWaterCutItems(MAX_PADRON_ITEMS + 1)).toHaveLength(MAX_PADRON_ITEMS);
  });
});
