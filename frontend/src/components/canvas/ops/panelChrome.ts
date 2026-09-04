export type CanvasToolbarPosition = 'top' | 'bottom';

export const PANEL_CHROME_KEYS = {
  left: 'antares.canvas.leftPanelOpen',
  right: 'antares.canvas.rightPanelOpen',
  lock: 'antares.canvas.uiLocked',
  toolbar: 'antares.canvas.toolbarPosition',
} as const;

export function readBoolLS(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    if (v === null) return fallback;
    return v === 'true';
  } catch {
    return fallback;
  }
}

export function writeBoolLS(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, String(value));
  } catch {
  }
}

export function readToolbarPosition(
  key: string,
  fallback: CanvasToolbarPosition,
): CanvasToolbarPosition {
  try {
    const value = localStorage.getItem(key);
    if (value === 'top' || value === 'bottom') return value;
  } catch {
  }
  return fallback;
}

export function writeToolbarPosition(key: string, value: CanvasToolbarPosition): void {
  try {
    localStorage.setItem(key, value);
  } catch {
  }
}

export function nextBothPanelsOpen(leftOpen: boolean, rightOpen: boolean): boolean {
  return !(leftOpen || rightOpen);
}
