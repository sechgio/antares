import { getLocalImageDataUrl } from '../../utils/localThumb';
import type { GenerarUbicacionesData } from '../../api';

export type Result =
  | { success: true; data: GenerarUbicacionesData }
  | { success: false; error: string }
  | null;

export type PreviewData = {
  image: string;
  image_path?: string;
  cod_componente: string;
  direccion: string;
  localidad: string;
  distrito: string;
  total_filas: number;
  row_index: number;
  formato?: string;
} | null;

export function isCspSafeImageSrc(src: string | undefined | null): boolean {
  if (!src || typeof src !== 'string') return false;
  return src.startsWith('data:') || src.startsWith('blob:');
}

export async function resolvePreviewImageSrc(data: {
  image?: string;
  image_path?: string;
}): Promise<string | null> {
  if (isCspSafeImageSrc(data.image)) return data.image ?? null;

  const localPath =
    (typeof data.image_path === 'string' && data.image_path.trim())
      ? data.image_path
      : (typeof data.image === 'string' && data.image.startsWith('file:')
        ? decodeURIComponent(data.image.replace(/^file:\/\//i, '').replace(/^\/([A-Za-z]:)/, '$1'))
        : '');

  if (!localPath) return null;
  return getLocalImageDataUrl(localPath);
}

export type OutputMode = 'individual' | 'consolidado';

export type TextFieldStyle = {
  fontSize: number;
  bold: boolean;
  color: string;
  offsetX: number;
  offsetY: number;
  visible: boolean;
};

export type CustomStyles = {
  texts: {
    cod_componente: Partial<TextFieldStyle>;
    direccion: Partial<TextFieldStyle>;
    localidad: Partial<TextFieldStyle>;
    distrito: Partial<TextFieldStyle>;
  };
  pin: {
    color?: string;
    scale?: number;
    offsetX?: number;
    offsetY?: number;
    visible?: boolean;
  };
  map: {
    overlayAlpha?: number;
    overlayColor?: string;
  };
  layout: {
    lineSpacing?: number;
    lineGap?: number;
    yStart?: number;
  };
};

export const DEFAULT_STYLES: CustomStyles = {
  texts: {
    cod_componente: { fontSize: 120, bold: true, color: '#000000', offsetX: 0, offsetY: 0, visible: true },
    direccion: { fontSize: 60, bold: true, color: '#000000', offsetX: 0, offsetY: 0, visible: true },
    localidad: { fontSize: 60, bold: true, color: '#000000', offsetX: 0, offsetY: 0, visible: true },
    distrito: { fontSize: 60, bold: true, color: '#000000', offsetX: 0, offsetY: 0, visible: true },
  },
  pin: { color: '', scale: 0.15, offsetX: 0, offsetY: 0, visible: true },
  map: { overlayAlpha: 120, overlayColor: '#F6F6F6' },
  layout: { lineSpacing: 180, lineGap: 0.7, yStart: 120 },
};

export const STORAGE_KEY = 'antares:ubicaciones:customStyles';
export const LS_OUTPUT_DIR = 'antares:ubicaciones:outputDir';
export const LS_FORMATO = 'antares:ubicaciones:formato';
export const LS_OUTPUT_MODE = 'antares:ubicaciones:outputMode';
export const LS_INPUT_MODE = 'antares:ubicaciones:inputMode';
export const LS_MANUAL_DATA = 'antares:ubicaciones:manualData';
export const LS_API_KEYS = 'antares:ubicaciones:apiKeys';
export const LS_GOOGLE_MAPS_KEY = 'antares:ubicaciones:googleMapsKey';
export const LS_ZOOM = 'antares:ubicaciones:zoom';
export const LS_PROVIDER = 'antares:ubicaciones:provider';
export const LS_GEOCODE = 'antares:ubicaciones:geocode';
export const LS_GEOCODE_COUNTRY = 'antares:ubicaciones:geocodeCountry';

export function clearPlaintextApiKeys(): void {
  localStorage.removeItem(LS_API_KEYS);
  localStorage.removeItem(LS_GOOGLE_MAPS_KEY);
}

export function readPlaintextApiKeys(): Record<string, string> {
  try {
    const saved = localStorage.getItem(LS_API_KEYS);
    if (saved) {
      const parsed: unknown = JSON.parse(saved);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const out: Record<string, string> = {};
        for (const [k, v] of Object.entries(parsed)) {
          if (typeof v === 'string' && v.trim()) out[k] = v;
        }
        return out;
      }
    }
    const oldGoogleKey = localStorage.getItem(LS_GOOGLE_MAPS_KEY);
    if (oldGoogleKey) return { google: oldGoogleKey };
  } catch {
  }
  return {};
}

export const DEFAULT_MANUAL_DATA = {
  cod_componente: '',
  direccion: '',
  localidad: '',
  distrito: '',
  lat: '',
  lon: '',
};

export type ManualData = typeof DEFAULT_MANUAL_DATA;

export function deepMergeStyles<T extends Record<string, unknown>>(base: T, patch: Record<string, unknown>): T {
  const out = { ...base };
  for (const key of Object.keys(patch)) {
    const val = patch[key];
    const baseVal = base[key];
    if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
      out[key as keyof T] = deepMergeStyles(
        (typeof baseVal === 'object' && baseVal !== null ? baseVal : {}) as Record<string, unknown>,
        val as Record<string, unknown>,
      ) as T[keyof T];
    } else if (val !== undefined) {
      out[key as keyof T] = val as T[keyof T];
    }
  }
  return out;
}

export function loadCustomStylesFromStorage(): CustomStyles {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? deepMergeStyles(DEFAULT_STYLES, JSON.parse(saved)) : DEFAULT_STYLES;
  } catch {
    return DEFAULT_STYLES;
  }
}

export const PIN_PRESETS = ['', '#00BCD4', '#E53935', '#43A047', '#FB8C00', '#8E24AA', '#1E88E5', '#000000'];

export const MAP_PROVIDERS = [
  { id: 'osm', label: 'OpenStreetMap', needsKey: false, helpUrl: '' },
  { id: 'google', label: 'Google Maps', needsKey: true, helpUrl: 'https://developers.google.com/maps/documentation/maps-static/get-api-key' },
  { id: 'mapbox', label: 'Mapbox', needsKey: true, helpUrl: 'https://docs.mapbox.com/help/glossary/access-token/' },
  { id: 'maptiler', label: 'MapTiler', needsKey: true, helpUrl: 'https://docs.maptiler.com/cloud/api/authentication-key/' },
  { id: 'stadia', label: 'Stadia Maps', needsKey: true, helpUrl: 'https://docs.stadiamaps.com/authentication/' },
  { id: 'geoapify', label: 'Geoapify', needsKey: true, helpUrl: 'https://www.geoapify.com/get-started-with-maps-api' },
  { id: 'thunderforest', label: 'Thunderforest', needsKey: true, helpUrl: 'https://www.thunderforest.com/docs/apikeys/' },
] as const;

export const MAP_PROVIDER_BY_ID = Object.fromEntries(MAP_PROVIDERS.map((p) => [p.id, p])) as Record<
  string,
  (typeof MAP_PROVIDERS)[number]
>;

export const TEXT_FIELDS = [
  { key: 'cod_componente' as const, label: 'Código' },
  { key: 'direccion' as const, label: 'Dirección' },
  { key: 'localidad' as const, label: 'Localidad' },
  { key: 'distrito' as const, label: 'Distrito' },
] as const;
