const STORAGE_KEY = 'espacios:focusTarget';
export const ESPACIOS_FOCUS_EVENT = 'espacios:focus';

export interface EspaciosFocusTarget {
  tareaId?: string | null;
  proyectoId?: string | null;
  espacioId?: string | null;
}

export function writeEspaciosFocusTarget(target: EspaciosFocusTarget): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(target));
  } catch {
    // Ignore storage failures in restricted environments.
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(ESPACIOS_FOCUS_EVENT));
  }
}

export function consumeEspaciosFocusTarget(): EspaciosFocusTarget | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(STORAGE_KEY);
    const parsed = JSON.parse(raw) as EspaciosFocusTarget;
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}
