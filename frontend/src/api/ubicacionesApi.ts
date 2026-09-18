import { _invoke } from './core';

interface UbicacionManualData {
  cod_componente: string;
  lat: number | string;
  lon: number | string;
  direccion?: string;
  localidad?: string;
  distrito?: string;
}

export interface PreviewUbicacionParams {
  excelPath: string | null;
  formato: string;
  rowIndex: number;
  recomposeOnly?: boolean;
  provider?: string;
  api_key?: string;
  zoom?: number;
  customStyles?: Record<string, unknown>;
  manualData?: UbicacionManualData;
}

interface PreviewUbicacionData {
  image: string;
  image_path?: string;
  cod_componente: string;
  direccion: string;
  localidad: string;
  distrito: string;
  datos: {
    cod_componente: string;
    lat: number;
    lon: number;
    direccion: string;
    localidad: string;
    distrito: string;
  };
  row_index: number;
  total_filas: number;
  formato: string;
}

export type PreviewUbicacionResponse = PreviewUbicacionData;

export interface GenerarUbicacionesParams {
  excelPath: string | null;
  outputDir: string;
  formato: string;
  consolidado: boolean;
  provider?: string;
  api_key?: string;
  zoom?: number;
  customStyles?: Record<string, unknown>;
  manualData?: UbicacionManualData;
}

export interface GenerarUbicacionesData {
  generados: number;
  fallidos: number;
  outputDir: string;
  consolidado: boolean;
  consolidatedPath: string | null;
}

export type GenerarUbicacionesResponse = GenerarUbicacionesData;

export const ubicacionesApi = {
  previewUbicacion: (body: PreviewUbicacionParams) => _invoke<PreviewUbicacionResponse>('preview_ubicacion', body),
  generarUbicaciones: (body: GenerarUbicacionesParams) => _invoke<GenerarUbicacionesResponse>('generar_ubicaciones', body),
  ubicacionesKeysGet: () =>
    _invoke<{ keys: Record<string, string>; configured?: Record<string, boolean> }>('ubicaciones_keys_get'),
  ubicacionesKeysSet: (keys: Record<string, string>) =>
    _invoke<{ keys: Record<string, string>; configured?: Record<string, boolean> }>('ubicaciones_keys_set', { keys }),
};
