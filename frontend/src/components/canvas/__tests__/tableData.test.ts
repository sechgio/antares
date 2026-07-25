import { describe, expect, it } from 'vitest';
import { parseTableData } from '../ops/tableData';

describe('parseTableData', () => {
  it('returns a single empty cell for undefined input', () => {
    expect(parseTableData(undefined)).toEqual({ cells: [['', '']] });
  });

  it('parses a valid {cells} payload', () => {
    const raw = JSON.stringify({ cells: [['a', 'b'], ['c', 'd']] });
    expect(parseTableData(raw)).toEqual({ cells: [['a', 'b'], ['c', 'd']] });
  });

  it('preserves fieldKeys when present', () => {
    const raw = JSON.stringify({ cells: [['a']], fieldKeys: [['k1', null]] });
    expect(parseTableData(raw)).toEqual({ cells: [['a']], fieldKeys: [['k1', null]] });
  });

  it('falls back to default for malformed JSON', () => {
    expect(parseTableData('{not json')).toEqual({ cells: [['', '']] });
    expect(parseTableData('null')).toEqual({ cells: [['', '']] });
    expect(parseTableData('42')).toEqual({ cells: [['', '']] });
  });

  it('falls back to default when cells is missing or not an array', () => {
    expect(parseTableData(JSON.stringify({ fieldKeys: [['x']] }))).toEqual({ cells: [['', '']] });
    expect(parseTableData(JSON.stringify({ cells: 'nope' }))).toEqual({ cells: [['', '']] });
  });
});
