import { describe, expect, it } from 'vitest';
import { diffLines, fileChange, markChanges, snippetStart } from './diffLines';

describe('markChanges', () => {
  it('resalta solo la palabra que cambió entre una línea borrada y su sustituta', () => {
    const [before, after] = markChanges(diffLines('total = price * qty', 'total = price * quantity'));
    expect(before).toMatchObject({ kind: 'remove', change: [16, 19] });
    expect(after).toMatchObject({ kind: 'add', change: [16, 24] });
    expect(after.text.slice(16, 24)).toBe('quantity');
  });

  it('no resalta tramos cuando la línea cambió casi entera', () => {
    expect(markChanges(diffLines('import os', 'print(total)')).every((line) => !line.change)).toBe(true);
  });
});

describe('snippetStart', () => {
  const result = JSON.stringify({ snippet: '7\tdef a():\n8\t    x = 1\n9\t    y = 2\n10\t    return 10\n11\t\n12\tdef b():' });

  it('sitúa el texto nuevo en el fragmento numerado aunque sea parte de una línea', () => {
    expect(snippetStart(result, diffLines('return 1', 'return 10'))).toBe(10);
  });

  it('devuelve null sin fragmento o si el texto nuevo no aparece', () => {
    expect(snippetStart(null, diffLines('a', 'b'))).toBeNull();
    expect(snippetStart(result, diffLines('a', 'zzz'))).toBeNull();
    expect(snippetStart(result, diffLines('borrar', ''))).toBeNull();
  });
});

describe('diffLines', () => {
  it('marca solo las líneas que cambian y conserva el contexto', () => {
    expect(diffLines('a\nb\nc\n', 'a\nB\nc\nd\n')).toEqual([
      { kind: 'context', text: 'a' },
      { kind: 'remove', text: 'b' },
      { kind: 'add', text: 'B' },
      { kind: 'context', text: 'c' },
      { kind: 'add', text: 'd' },
    ]);
  });

  it('trata CRLF como LF y un texto vacío como archivo sin líneas', () => {
    expect(diffLines('x\r\ny', 'x\ny')).toEqual([{ kind: 'context', text: 'x' }, { kind: 'context', text: 'y' }]);
    expect(diffLines('', 'nuevo')).toEqual([{ kind: 'add', text: 'nuevo' }]);
  });

  it('degrada a borrar y añadir cuando el bloque es demasiado grande', () => {
    const before = Array.from({ length: 300 }, (_, i) => `a${i}`).join('\n');
    const after = Array.from({ length: 300 }, (_, i) => `b${i}`).join('\n');
    const result = diffLines(before, after);
    expect(result.slice(0, 300).every((line) => line.kind === 'remove')).toBe(true);
    expect(result.slice(300).every((line) => line.kind === 'add')).toBe(true);
  });
});

describe('fileChange', () => {
  it('cuenta un hunk por edición y entiende fs_write', () => {
    const edit = fileChange('fs_edit', { path: 'a.py', edits: [{ old: 'x = 1', new: 'x = 2' }, { old: 'y', new: 'y\nz' }] });
    expect(edit).toMatchObject({ added: 2, removed: 1, whole: false });
    expect(edit?.hunks).toHaveLength(2);
    expect(edit?.starts).toEqual([null, null]);
    expect(fileChange('fs_write', { path: 'n.txt', content: 'uno\ndos' })).toMatchObject({ added: 2, removed: 0, whole: true, starts: [1] });
    const single = fileChange('fs_edit', { path: 'a', old: 'b', new: 'B' }, JSON.stringify({ snippet: '4\ta\n5\tB\n6\tc' }));
    expect(single?.starts).toEqual([5]);
  });

  it('no inventa un diff con parámetros incompletos u otras herramientas', () => {
    expect(fileChange('fs_edit', { path: 'a', old: 'x' })).toBeNull();
    expect(fileChange('fs_edit', { path: 'a', edits: [] })).toBeNull();
    expect(fileChange('fs_read', { path: 'a' })).toBeNull();
  });
});
