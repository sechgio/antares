import { describe, expect, it } from 'vitest';
import {
  clampLeftPanelWidth,
  LEFT_PANEL_WIDTH_DEFAULT,
  LEFT_PANEL_WIDTH_MAX,
  LEFT_PANEL_WIDTH_MIN,
  nextBothPanelsOpen,
  readBoolLS,
  readLeftPanelWidth,
  readToolbarPosition,
  writeBoolLS,
  writeLeftPanelWidth,
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

  it('clampLeftPanelWidth stays within local UI bounds without touching the document', () => {
    expect(clampLeftPanelWidth(LEFT_PANEL_WIDTH_DEFAULT)).toBe(LEFT_PANEL_WIDTH_DEFAULT);
    expect(clampLeftPanelWidth(80)).toBe(LEFT_PANEL_WIDTH_MIN);
    expect(clampLeftPanelWidth(900)).toBe(LEFT_PANEL_WIDTH_MAX);
    expect(clampLeftPanelWidth(Number.NaN)).toBe(LEFT_PANEL_WIDTH_DEFAULT);
  });

  it('readLeftPanelWidth / writeLeftPanelWidth round-trip from localStorage', () => {
    const key = 'antares.canvas.test.leftPanelWidth';
    localStorage.removeItem(key);
    expect(readLeftPanelWidth(key)).toBe(LEFT_PANEL_WIDTH_DEFAULT);
    writeLeftPanelWidth(key, 312);
    expect(readLeftPanelWidth(key)).toBe(312);
    writeLeftPanelWidth(key, 40);
    expect(readLeftPanelWidth(key)).toBe(LEFT_PANEL_WIDTH_MIN);
    localStorage.removeItem(key);
  });
});
