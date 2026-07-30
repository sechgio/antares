/** Session UI chrome prefs for Canvas sidebars (not document settings). */

export const PANEL_CHROME_KEYS = {
  left: 'antares.canvas.leftPanelOpen',
  right: 'antares.canvas.rightPanelOpen',
  lock: 'antares.canvas.uiLocked',
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
    // Quota / private mode — ignore.
  }
}

/** Figma-like Ctrl+\ : any open → close both; both closed → open both. */
export function nextBothPanelsOpen(leftOpen: boolean, rightOpen: boolean): boolean {
  return !(leftOpen || rightOpen);
}
