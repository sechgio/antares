/** User-renamed canvas preset labels (session UI pref, not document state).
 * Mirrors the panelChrome.ts LS pattern: best-effort, silent on quota/private mode. */

const STORAGE_KEY = 'antares.canvas.presetLabels';

type LabelMap = Record<string, string>;

function readRaw(): LabelMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as LabelMap) : {};
  } catch {
    return {};
  }
}

export function getPresetLabel(presetId: string, fallback: string): string {
  const map = readRaw();
  const custom = map[presetId];
  return custom && custom.trim() ? custom : fallback;
}

export function setPresetLabel(presetId: string, label: string): void {
  const trimmed = label.trim();
  const map = readRaw();
  if (trimmed) {
    map[presetId] = trimmed;
  } else {
    delete map[presetId];
  }
  try {
    if (Object.keys(map).length === 0) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
    }
  } catch {
    // Quota / private mode — ignore.
  }
}

export function resetPresetLabel(presetId: string): void {
  const map = readRaw();
  if (!(presetId in map)) return;
  delete map[presetId];
  try {
    if (Object.keys(map).length === 0) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
    }
  } catch {
    // ignore
  }
}

export function resolvePresetLabels(
  presets: ReadonlyArray<{ id: string; label: string }>,
): Array<{ id: string; label: string }> {
  const map = readRaw();
  return presets.map((p) => ({
    id: p.id,
    label: map[p.id]?.trim() ? map[p.id] : p.label,
  }));
}
