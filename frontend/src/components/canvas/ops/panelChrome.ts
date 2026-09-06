export type CanvasToolbarPosition = 'top' | 'bottom';

export const PANEL_CHROME_KEYS = {
  left: 'antares.canvas.leftPanelOpen',
  right: 'antares.canvas.rightPanelOpen',
  lock: 'antares.canvas.uiLocked',
  toolbar: 'antares.canvas.toolbarPosition',
  leftWidth: 'antares.canvas.leftPanelWidth',
} as const;

export const LEFT_PANEL_WIDTH_MIN = 200;
export const LEFT_PANEL_WIDTH_MAX = 420;
export const LEFT_PANEL_WIDTH_DEFAULT = 248;

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

export function clampLeftPanelWidth(width: number): number {
  if (!Number.isFinite(width)) return LEFT_PANEL_WIDTH_DEFAULT;
  return Math.min(LEFT_PANEL_WIDTH_MAX, Math.max(LEFT_PANEL_WIDTH_MIN, Math.round(width)));
}

export function readLeftPanelWidth(key: string, fallback = LEFT_PANEL_WIDTH_DEFAULT): number {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return clampLeftPanelWidth(fallback);
    return clampLeftPanelWidth(Number(raw));
  } catch {
    return clampLeftPanelWidth(fallback);
  }
}

export function writeLeftPanelWidth(key: string, width: number): void {
  try {
    localStorage.setItem(key, String(clampLeftPanelWidth(width)));
  } catch {
  }
}
