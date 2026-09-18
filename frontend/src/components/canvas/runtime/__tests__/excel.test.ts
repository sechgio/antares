import { describe, expect, it, vi } from 'vitest';

const stageAndParseSpreadsheet = vi.fn();

vi.mock('../../../../utils/spreadsheet', () => ({
  stageAndParseSpreadsheet: (...args: unknown[]) => stageAndParseSpreadsheet(...args),
}));

import { buildRowData, parseSpreadsheetFile } from '../excel';

describe('canvas runtime excel', () => {
  it('parseSpreadsheetFile elige la hoja con datos y mapea filas a objetos', async () => {
    stageAndParseSpreadsheet.mockResolvedValue({
      sheets: [
        { name: 'vacía', rows: [['solo-header']] },
        { name: 'datos', rows: [['Nombre', 'Distrito'], ['ACME', 'Lima'], ['XYZ', 'Surco']] },
      ],
    });
    const out = await parseSpreadsheetFile(new File(['x'], 'a.xlsx'));
    expect(out.headers).toEqual(['Nombre', 'Distrito']);
    expect(out.rows).toEqual([
      { Nombre: 'ACME', Distrito: 'Lima' },
      { Nombre: 'XYZ', Distrito: 'Surco' },
    ]);
  });

  it('cae a una hoja con solo header si ninguna tiene datos', async () => {
    stageAndParseSpreadsheet.mockResolvedValue({
      sheets: [{ name: 'h', rows: [['A', 'B']] }],
    });
    const out = await parseSpreadsheetFile(new File(['x'], 'a.csv'));
    expect(out.headers).toEqual(['A', 'B']);
    expect(out.rows).toEqual([]);
  });

  it('sin hojas útiles devuelve estructura vacía', async () => {
    stageAndParseSpreadsheet.mockResolvedValue({ sheets: [{ name: 'v', rows: [] }] });
    const out = await parseSpreadsheetFile(new File(['x'], 'a.csv'));
    expect(out).toEqual({ headers: [], rows: [] });
  });

  it('celdas null se convierten en cadena vacía', async () => {
    stageAndParseSpreadsheet.mockResolvedValue({
      sheets: [{ name: 'h', rows: [['A', 'B'], ['x', null]] }],
    });
    const out = await parseSpreadsheetFile(new File(['x'], 'a.csv'));
    expect(out.rows[0]).toEqual({ A: 'x', B: '' });
  });

  it('buildRowData duplica el valor bajo el field key en minúscula y mayúscula', () => {
    const row = { Cliente: 'ACME', Distrito: 'Lima' };
    const data = buildRowData(row, { nombre: 'Cliente', zona: 'Distrito', vacio: '' });
    expect(data.nombre).toBe('ACME');
    expect(data.NOMBRE).toBe('ACME');
    expect(data.zona).toBe('Lima');
    // mapping con columna vacía no añade nada
    expect('vacio' in data).toBe(false);
    expect('VACIO' in data).toBe(false);
    // la fila original se conserva
    expect(data.Cliente).toBe('ACME');
  });

  it('buildRowData con columna inexistente produce cadena vacía', () => {
    const data = buildRowData({}, { f: 'NoExiste' });
    expect(data.f).toBe('');
    expect(data.F).toBe('');
  });
});
