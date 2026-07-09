import { describe, expect, it } from 'vitest';
import {
  createEmptyFicha,
  createTemplatePlaceholderFicha,
  normalizeFicha,
  normalizeFichaForPreview,
} from './types';

describe('fichas-tecnicas types helpers', () => {
  it('createTemplatePlaceholderFicha matches demo plantilla fields', () => {
    const ficha = createTemplatePlaceholderFicha();
    expect(ficha.id).toBe('XXXXXXXX');
    expect(ficha.cliente).toBe('NOMBRE DEL CLIENTE');
    expect(ficha.direccion).toBe('DIRECCION DE LA OBRA');
    expect(ficha.distrito).toBe('DISTRITO');
    expect(ficha.productos).toHaveLength(4);
    expect(ficha.personal_tecnico).toHaveLength(6);
  });

  it('normalizeFichaForPreview returns empty structure when null (sech-gio blank plantilla)', () => {
    const normalized = normalizeFichaForPreview(null);
    expect(normalized.cliente).toBe('');
    expect(normalized.productos).toHaveLength(4);
    expect(normalized.personal_tecnico).toHaveLength(6);
  });

  it('normalizeFicha fills missing nested objects without crashing form', () => {
    const normalized = normalizeFicha({ id: 'FT-1', cliente: 'X' });
    expect(normalized.id).toBe('FT-1');
    expect(normalized.cliente).toBe('X');
    expect(normalized.servicio.desinfeccion).toBe(false);
    expect(normalized.productos).toHaveLength(4);
  });

  it('normalizeFichaForPreview pads incomplete nested data', () => {
    const partial = createEmptyFicha();
    partial.productos = [
      {
        producto: 'P1',
        composicion: '',
        lote: '',
        fecha_vencimiento: '',
        unidad: '',
        concentracion: '',
        cantidad: '',
      },
    ];
    partial.personal_tecnico = ['A'];
    const normalized = normalizeFichaForPreview(partial);
    expect(normalized.productos).toHaveLength(4);
    expect(normalized.productos[0].producto).toBe('P1');
    expect(normalized.personal_tecnico).toHaveLength(6);
    expect(normalized.personal_tecnico[0]).toBe('A');
  });
});

