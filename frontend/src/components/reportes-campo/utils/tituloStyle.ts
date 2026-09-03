export const TITULO_SIZE_KEY = 'tituloSize';
export const TITULO_COLOR_KEY = 'tituloColor';

export const DEFAULT_TITULO_SIZE_PX = 14;
export const DEFAULT_TITULO_COLOR = '#000000';

export const TITULO_SIZE_OPTIONS = [10, 12, 14, 16, 18, 20, 22, 24, 28] as const;

const HEX_COLOR_RE = /^#([0-9A-Fa-f]{6})$/;

export interface TituloStyle {
    fontSizePx: number;
    color: string;
}

export function isTituloStyleKey(key: string): boolean {
    return key === TITULO_SIZE_KEY || key === TITULO_COLOR_KEY;
}

export function stepTituloSize(size: number, direction: -1 | 1): number {
    const presets = TITULO_SIZE_OPTIONS as readonly number[];
    if (direction === 1) {
        return presets.find((p) => p > size) ?? presets[presets.length - 1];
    }
    for (let i = presets.length - 1; i >= 0; i -= 1) {
        if (presets[i] < size) return presets[i];
    }
    return presets[0];
}

export function resolveTituloStyle(header: Record<string, string | undefined>): TituloStyle {
    const rawSize = Number.parseInt(String(header[TITULO_SIZE_KEY] ?? ''), 10);
    const fontSizePx =
        Number.isFinite(rawSize) && rawSize >= 8 && rawSize <= 36
            ? rawSize
            : DEFAULT_TITULO_SIZE_PX;

    const rawColor = String(header[TITULO_COLOR_KEY] ?? '').trim();
    const color = HEX_COLOR_RE.test(rawColor) ? rawColor.toUpperCase() : DEFAULT_TITULO_COLOR;

    return { fontSizePx, color };
}
