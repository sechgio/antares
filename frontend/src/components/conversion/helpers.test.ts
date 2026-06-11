import { describe, expect, it } from 'vitest';
import { pickSyncedKeyColumn } from './helpers';

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
