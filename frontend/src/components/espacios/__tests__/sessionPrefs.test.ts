import { beforeEach, describe, expect, it } from 'vitest';
import {
  ESPACIOS_PREFS_KEY,
  readEspaciosPrefs,
  writeEspaciosPrefs,
} from '../utils/sessionPrefs';

describe('sessionPrefs', () => {
  beforeEach(() => {
    localStorage.removeItem(ESPACIOS_PREFS_KEY);
  });

  it('returns defaults when empty', () => {
    expect(readEspaciosPrefs()).toEqual({
      activeEspacioId: null,
      activeProyectoId: null,
      activeView: 'list',
    });
  });

  it('persists and merges patches', () => {
    writeEspaciosPrefs({ activeEspacioId: 'e1', activeView: 'gantt' });
    expect(readEspaciosPrefs()).toEqual({
      activeEspacioId: 'e1',
      activeProyectoId: null,
      activeView: 'gantt',
    });

    writeEspaciosPrefs({ activeProyectoId: 'p1' });
    expect(readEspaciosPrefs()).toEqual({
      activeEspacioId: 'e1',
      activeProyectoId: 'p1',
      activeView: 'gantt',
    });
  });

  it('ignores invalid view values', () => {
    localStorage.setItem(
      ESPACIOS_PREFS_KEY,
      JSON.stringify({ activeView: 'not-a-view', activeEspacioId: 'e1' }),
    );
    expect(readEspaciosPrefs().activeView).toBe('list');
    expect(readEspaciosPrefs().activeEspacioId).toBe('e1');
  });
});
