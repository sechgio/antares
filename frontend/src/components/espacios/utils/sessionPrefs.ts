import type { VistaType } from '../types';

export const ESPACIOS_PREFS_KEY = 'antares.espacios.prefs';

export interface EspaciosPrefs {
  activeEspacioId: string | null;
  activeProyectoId: string | null;
  activeView: VistaType;
}

const VIEWS: VistaType[] = ['list', 'board', 'table', 'calendar', 'gantt'];

const DEFAULTS: EspaciosPrefs = {
  activeEspacioId: null,
  activeProyectoId: null,
  activeView: 'list',
};

function isVistaType(value: unknown): value is VistaType {
  return typeof value === 'string' && (VIEWS as string[]).includes(value);
}

export function readEspaciosPrefs(): EspaciosPrefs {
  try {
    const raw = localStorage.getItem(ESPACIOS_PREFS_KEY);
    if (raw == null || raw === '') return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<EspaciosPrefs>;
    return {
      activeEspacioId:
        typeof parsed.activeEspacioId === 'string' ? parsed.activeEspacioId : null,
      activeProyectoId:
        typeof parsed.activeProyectoId === 'string' ? parsed.activeProyectoId : null,
      activeView: isVistaType(parsed.activeView) ? parsed.activeView : DEFAULTS.activeView,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function writeEspaciosPrefs(patch: Partial<EspaciosPrefs>): void {
  try {
    const current = readEspaciosPrefs();
    const next: EspaciosPrefs = {
      activeEspacioId:
        patch.activeEspacioId !== undefined ? patch.activeEspacioId : current.activeEspacioId,
      activeProyectoId:
        patch.activeProyectoId !== undefined ? patch.activeProyectoId : current.activeProyectoId,
      activeView: patch.activeView !== undefined && isVistaType(patch.activeView)
        ? patch.activeView
        : current.activeView,
    };
    localStorage.setItem(ESPACIOS_PREFS_KEY, JSON.stringify(next));
  } catch {
    // private mode / quota — ignore
  }
}
