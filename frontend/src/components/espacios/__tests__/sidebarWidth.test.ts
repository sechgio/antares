import { afterEach, describe, expect, it } from 'vitest';
import {
  clampSidebarWidth,
  ESPACIOS_SIDEBAR_DEFAULT_WIDTH,
  ESPACIOS_SIDEBAR_MAX_WIDTH,
  ESPACIOS_SIDEBAR_MIN_WIDTH,
  ESPACIOS_SIDEBAR_WIDTH_KEY,
  readStoredSidebarWidth,
  writeStoredSidebarWidth,
} from '../utils/sidebarWidth';

describe('clampSidebarWidth', () => {
  it('clamps to min and max', () => {
    expect(clampSidebarWidth(10)).toBe(ESPACIOS_SIDEBAR_MIN_WIDTH);
    expect(clampSidebarWidth(9999)).toBe(ESPACIOS_SIDEBAR_MAX_WIDTH);
    expect(clampSidebarWidth(300)).toBe(300);
  });

  it('falls back on non-finite values', () => {
    expect(clampSidebarWidth(Number.NaN)).toBe(ESPACIOS_SIDEBAR_DEFAULT_WIDTH);
    expect(clampSidebarWidth(Infinity)).toBe(ESPACIOS_SIDEBAR_DEFAULT_WIDTH);
  });

  it('rounds to integer pixels', () => {
    expect(clampSidebarWidth(250.7)).toBe(251);
  });
});

describe('sidebar width storage', () => {
  afterEach(() => {
    localStorage.removeItem(ESPACIOS_SIDEBAR_WIDTH_KEY);
  });

  it('reads default when empty', () => {
    expect(readStoredSidebarWidth()).toBe(ESPACIOS_SIDEBAR_DEFAULT_WIDTH);
  });

  it('persists and clamps stored values', () => {
    writeStoredSidebarWidth(320);
    expect(readStoredSidebarWidth()).toBe(320);

    localStorage.setItem(ESPACIOS_SIDEBAR_WIDTH_KEY, '50');
    expect(readStoredSidebarWidth()).toBe(ESPACIOS_SIDEBAR_MIN_WIDTH);
  });
});
