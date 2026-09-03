export const ESPACIOS_SIDEBAR_DEFAULT_WIDTH = 240;
export const ESPACIOS_SIDEBAR_MIN_WIDTH = 180;
export const ESPACIOS_SIDEBAR_MAX_WIDTH = 420;
export const ESPACIOS_SIDEBAR_WIDTH_KEY = 'antares.espacios.sidebarWidth';

export function clampSidebarWidth(width: number): number {
  if (!Number.isFinite(width)) return ESPACIOS_SIDEBAR_DEFAULT_WIDTH;
  return Math.max(
    ESPACIOS_SIDEBAR_MIN_WIDTH,
    Math.min(ESPACIOS_SIDEBAR_MAX_WIDTH, Math.round(width)),
  );
}

export function readStoredSidebarWidth(): number {
  try {
    const raw = localStorage.getItem(ESPACIOS_SIDEBAR_WIDTH_KEY);
    if (raw == null || raw === '') return ESPACIOS_SIDEBAR_DEFAULT_WIDTH;
    return clampSidebarWidth(Number(raw));
  } catch {
    return ESPACIOS_SIDEBAR_DEFAULT_WIDTH;
  }
}

export function writeStoredSidebarWidth(width: number): void {
  try {
    localStorage.setItem(ESPACIOS_SIDEBAR_WIDTH_KEY, String(clampSidebarWidth(width)));
  } catch {
    // ignore quota / private mode
  }
}
