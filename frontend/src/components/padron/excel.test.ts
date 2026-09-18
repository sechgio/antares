import { describe, expect, it, vi } from 'vitest';

const stageAndParseSpreadsheet = vi.fn();

vi.mock('../../utils/spreadsheet', () => ({
  stageAndParseSpreadsheet: (...args: unknown[]) => stageAndParseSpreadsheet(...args),
}));

import { parseWorkbook } from './excel';

function sheetRes(sheets: { name: string; rows: unknown[][] }[], workbookName = 'wb.xlsx') {
  return { workbookName, sheets };
}

const file = new File(['x'], 'padron.xlsx');

describe('padron/excel parseWorkbook', () => {
  it('mapea headers por alias ignorando diacríticos y capitalización', async () => {
    stageAndParseSpreadsheet.mockResolvedValue(
      sheetRes([
        {
          name: 'Hoja1',
          rows: [
            ['DISTRITO', 'Área Afectada', 'Fecha de Inicio'],
            ['LIMA', 'Centro', '2025-03-10'],
          ],
        },
      ]),
    );
    const out = await parseWorkbook(file);
    expect(out.records).toHaveLength(1);
    const rec = out.records[0];
    expect(rec.label).toBe('Hoja1 - Fila 2');
    expect(rec.data.distrito).toBe('LIMA');
    expect(rec.data.areaAfectada).toBe('Centro');
    // fecha ISO → dd/mm/yyyy
    expect(rec.data.fechaInicio).toBe('10/03/2025');
  });

  it('sin filas con alias devuelve un registro Manual de fallback', async () => {
    stageAndParseSpreadsheet.mockResolvedValue(
      sheetRes([{ name: 'Vacia', rows: [['x', 'y'], ['1', '2']] }]),
    );
    const out = await parseWorkbook(file);
    expect(out.records).toHaveLength(1);
    expect(out.records[0].id).toBe('manual-0');
    expect(out.records[0].sheetName).toBe('Manual');
  });

  it('importa items de padrón por aliases de item', async () => {
    stageAndParseSpreadsheet.mockResolvedValue(
      sheetRes([
        {
          name: 'Items',
          rows: [
            ['Nro', 'Nombres y Apellidos', 'Dirección'],
            ['1', 'Juan Pérez', 'Av. Lima 123'],
            ['2', 'Ana Díaz', 'Calle 9'],
          ],
        },
      ]),
    );
    const out = await parseWorkbook(file);
    expect(out.importedItems).toHaveLength(2);
    expect(out.importedItems[0].nombresApellidos).toBe('Juan Pérez');
    expect(out.importedItems[1].direccion).toBe('Calle 9');
  });

  it('descarta filas de items sin columnas mapeables', async () => {
    stageAndParseSpreadsheet.mockResolvedValue(
      sheetRes([
        {
          name: 'Items',
          rows: [
            ['ColumnaRara', 'OtraRara'],
            ['1', 'valor'],
          ],
        },
      ]),
    );
    const out = await parseWorkbook(file);
    expect(out.importedItems).toHaveLength(0);
  });

  it('formato water-cut-notice usa aliases y campos de fecha propios', async () => {
    stageAndParseSpreadsheet.mockResolvedValue(
      sheetRes([
        {
          name: 'Corte',
          rows: [
            ['Cuadrante', 'Fecha de Corte', 'Motivo'],
            ['C-9', '2025-06-01', 'mantenimiento'],
          ],
        },
        {
          name: 'Items',
          rows: [
            ['Nombre', 'DNI', 'Fecha'],
            ['Pedro Ruiz', '12345678', '2025-06-01'],
          ],
        },
      ]),
    );
    const out = await parseWorkbook(file, 'water-cut-notice');
    const rec = out.records.find((r) => r.sheetName === 'Corte');
    expect(rec?.data.cuadranteAfectado).toBe('C-9');
    expect(rec?.data.fechaCorte).toBe('01/06/2025');
    expect(out.importedWaterCutItems).toHaveLength(1);
    expect(out.importedWaterCutItems[0].dni).toBe('12345678');
    expect(out.importedWaterCutItems[0].fecha).toBe('01/06/2025');
  });

  it('hojas sin filas se conservan vacías sin romper', async () => {
    stageAndParseSpreadsheet.mockResolvedValue(
      sheetRes([
        { name: 'Vacia', rows: [] },
        { name: 'Datos', rows: [['Distrito'], ['Lima']] },
      ]),
    );
    const out = await parseWorkbook(file);
    expect(out.records).toHaveLength(1);
    expect(out.workbookName).toBe('wb.xlsx');
  });
});
