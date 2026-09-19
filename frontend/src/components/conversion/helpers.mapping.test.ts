import { describe, expect, it } from 'vitest';
import { computeMappingStats, findMappingCollisions, isMappingSchemaMismatch, pickSyncedKeyColumn } from './helpers';

describe('mapping helpers', () => {
  it('computes matched, unmatched and orphan stats locally', () => {
    const mapping = {
      'IMG_0001.jpg': 'uno',
      'IMG_0002.jpg': 'dos',
      'IMG_0003.jpg': 'tres',
    };
    const stats = computeMappingStats(mapping, [
      'C:\\fotos\\IMG_0001.jpg',
      'C:\\fotos\\IMG_0002.jpg',
      'C:\\fotos\\missing.jpg',
    ]);

    expect(stats.matchedFiles).toBe(2);
    expect(stats.unmatchedFiles).toEqual(['missing.jpg']);
    expect(stats.orphanEntries).toEqual(['IMG_0003.jpg']);
    expect(stats.collisions).toEqual([]);
  });

  it('detects output name collisions', () => {
    const mapping = { 'A.jpg': 'mismo', 'B.jpg': 'mismo' };
    const collisions = findMappingCollisions(mapping, ['C:/tmp/A.jpg', 'C:/tmp/B.jpg']);
    expect(collisions).toHaveLength(1);
    expect(collisions[0].output).toBe('mismo.jpg');
    expect(collisions[0].sources).toEqual(['A.jpg', 'B.jpg']);
  });

  it('lookup is case insensitive', () => {
    const stats = computeMappingStats({ 'img_0001.jpg': 'fachada' }, ['IMG_0001.jpg']);
    expect(stats.matchedFiles).toBe(1);
  });

  it('does not last-write-wins on stem conflicts (parity with MappingIndex)', () => {
    const mapping = { '123.jpg': 'a', '123': 'b' };
    const stats = computeMappingStats(mapping, [
      'C:\\fotos\\123.jpg',
      'C:\\fotos\\123.png',
    ]);
    expect(stats.matchedFiles).toBe(1);
    expect(stats.unmatchedFiles).toEqual(['123.png']);
  });

  it('treats case-only stem disagreement as a conflict', () => {
    const mapping = { 'A.jpg': 'uno', 'a.png': 'dos' };
    const stats = computeMappingStats(mapping, ['A.jpg', 'a.png', 'a.gif']);
    expect(stats.matchedFiles).toBe(2);
    expect(stats.unmatchedFiles).toEqual(['a.gif']);
  });

  it('falls back to catalog import only for mapping schema mismatches', () => {
    expect(isMappingSchemaMismatch(new Error('El Excel de mapeo necesita al menos 2 columnas'))).toBe(true);
    expect(isMappingSchemaMismatch(new Error('No se detectó una columna ID'))).toBe(true);
    expect(isMappingSchemaMismatch(new Error('No se detectó una columna de nuevo nombre'))).toBe(true);
    expect(isMappingSchemaMismatch(new Error("ID duplicado 'A.jpg' en la fila 3"))).toBe(false);
    expect(isMappingSchemaMismatch(new Error('Nuevo nombre vacío en la fila 4'))).toBe(false);
  });
});

describe('conversion helpers', () => {
  it('keeps the selected key column when it exists in the imported columns', () => {
    expect(pickSyncedKeyColumn('archivo', ['codigo', 'archivo'])).toBe('archivo');
  });

  it('falls back to the first imported column when the previous key is stale', () => {
    expect(pickSyncedKeyColumn('codigo', ['archivo', 'cliente'])).toBe('archivo');
  });

  it('clears the key column when no columns are available', () => {
    expect(pickSyncedKeyColumn('codigo', [])).toBe('');
  });
});
