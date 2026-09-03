import { describe, expect, it } from 'vitest';
import {
  nextBothPanelsOpen,
  readBoolLS,
  readToolbarPosition,
  writeBoolLS,
  writeToolbarPosition,
} from '../ops/panelChrome';

describe('panelChrome', () => {
  it('nextBothPanelsOpen closes when any panel is open', () => {
    expect(nextBothPanelsOpen(true, true)).toBe(false);
    expect(nextBothPanelsOpen(true, false)).toBe(false);
    expect(nextBothPanelsOpen(false, true)).toBe(false);
  });

  it('nextBothPanelsOpen opens when both are closed', () => {
    expect(nextBothPanelsOpen(false, false)).toBe(true);
  });

  it('readBoolLS / writeBoolLS round-trip', () => {
    const key = 'antares.canvas.test.panelChrome';
    localStorage.removeItem(key);
    expect(readBoolLS(key, true)).toBe(true);
    writeBoolLS(key, false);
    expect(readBoolLS(key, true)).toBe(false);
    writeBoolLS(key, true);
    expect(readBoolLS(key, false)).toBe(true);
    localStorage.removeItem(key);
  });

  it('readToolbarPosition / writeToolbarPosition round-trip and validate values', () => {
    const key = 'antares.canvas.test.toolbarPosition';
    localStorage.removeItem(key);
    expect(readToolbarPosition(key, 'top')).toBe('top');

    writeToolbarPosition(key, 'bottom');
    expect(readToolbarPosition(key, 'top')).toBe('bottom');

    localStorage.setItem(key, 'invalid');
    expect(readToolbarPosition(key, 'bottom')).toBe('bottom');
    localStorage.removeItem(key);
  });
});
