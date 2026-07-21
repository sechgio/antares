export type Result = { success: boolean; data?: any; error?: string } | null;

export type PreviewData = {
  image: string;
  cod_componente: string;
  direccion: string;
  localidad: string;
  distrito: string;
  total_filas: number;
  row_index: number;
  formato?: string;
} | null;

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

export const DEFAULT_MANUAL_DATA = {
  cod_componente: '',
  direccion: '',
  localidad: '',
  distrito: '',
  lat: '',
  lon: '',
};

export type ManualData = typeof DEFAULT_MANUAL_DATA;

export const PIN_PRESETS = ['', '#00BCD4', '#E53935', '#43A047', '#FB8C00', '#8E24AA', '#1E88E5', '#333333'] as const;

export const MAP_PROVIDERS = [
  { id: 'carto_light', label: 'Carto Light (Positron)', needsKey: false, helpUrl: '' },
  { id: 'carto_dark', label: 'Carto Dark Matter', needsKey: false, helpUrl: '' },
  { id: 'osm', label: 'OpenStreetMap', needsKey: false, helpUrl: '' },
  { id: 'esri_sat', label: 'Esri Satellite', needsKey: false, helpUrl: '' },
  { id: 'mapbox_streets', label: 'Mapbox Streets', needsKey: true, helpUrl: 'https://account.mapbox.com/' },
  { id: 'maptiler', label: 'MapTiler Basic', needsKey: true, helpUrl: 'https://docs.maptiler.com/cloud/api/authentication-key/' },
  { id: 'stadia', label: 'Stadia Maps', needsKey: true, helpUrl: 'https://docs.stadiamaps.com/authentication/' },
  { id: 'geoapify', label: 'Geoapify', needsKey: true, helpUrl: 'https://www.geoapify.com/get-started-with-maps-api' },
  { id: 'thunderforest', label: 'Thunderforest', needsKey: true, helpUrl: 'https://www.thunderforest.com/docs/apikeys/' },
] as const;

export type MapProvider = (typeof MAP_PROVIDERS)[number];

export const MAP_PROVIDER_BY_ID = Object.fromEntries(MAP_PROVIDERS.map((p) => [p.id, p])) as Record<
  string,
  MapProvider
>;

export const TEXT_FIELDS = [
  { key: 'cod_componente' as const, label: 'Código' },
  { key: 'direccion' as const, label: 'Dirección' },
  { key: 'localidad' as const, label: 'Localidad' },
  { key: 'distrito' as const, label: 'Distrito' },
] as const;

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
