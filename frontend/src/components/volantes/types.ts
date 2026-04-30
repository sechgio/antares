export type LayoutMode = "2-up" | "3-up";

export interface FlyerRecord {
  id: string;
  distrito: string;
  fecha: string;
  horaInicio: string;
  horaFin: string;
  reservorio: string;
  sector: string;
  zonasAfectadas: string;
  titleSize2up?: number;
  titleSize3up?: number;
  districtSize2up?: number;
  districtSize3up?: number;
  headingsSize2up?: number;
  headingsSize3up?: number;
  serviceSize2up?: number;
  serviceSize3up?: number;
  reservoirSize2up?: number;
  reservoirSize3up?: number;
  sectorSize2up?: number;
  sectorSize3up?: number;
  zonesFontSize2up?: number;
  zonesFontSize3up?: number;
}

export interface BrandConfig {
  logoIzquierdo: string | null;
  logoDerecho: string | null;
}

export interface ImportResult {
  records: FlyerRecord[];
  warnings: string[];
}

export interface RawFlyerRecord {
  item?: unknown;
  sgio?: unknown;
  distrito?: unknown;
  fecha?: unknown;
  hora_inicio?: unknown;
  hora_fin?: unknown;
  reservorio?: unknown;
  sector?: unknown;
  zonas_afectadas?: unknown;
}
