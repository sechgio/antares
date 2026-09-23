import type { ReportStatus, ReservoirType } from '../../types/reports';

export type { ReservoirType };

export type PlantillaId = 'clasica' | 'reservorios2';

export const DIAMETERS = ['2', '4', '6', '8', '10', '12', '14', '16'] as const;

export const VALVULA_ROWS = ['conduccion', 'impulsion', 'aduccion', 'bypass', 'purga'] as const;
export const LINEA_ROWS = ['aduccion', 'alimentacion', 'impulsion_rebombeo', 'rebose', 'purga'] as const;

export const VALVULA_LABELS: Record<(typeof VALVULA_ROWS)[number], string> = {
  conduccion: 'CONDUCCION',
  impulsion: 'IMPULSION',
  aduccion: 'ADUCCION',
  bypass: 'BY PASS',
  purga: 'PURGA',
};

export const LINEA_LABELS: Record<(typeof LINEA_ROWS)[number], string> = {
  aduccion: 'ADUCCION',
  alimentacion: 'ALIMENTACION',
  impulsion_rebombeo: 'IMPULSION (REBOMBEO)',
  rebose: 'REBOSE',
  purga: 'PURGA',
};

export const R2_TITULO_LINEA1 = 'Limpieza y Desinfección de Reservorios y Cisternas';
export const R2_TITULO_LINEA2 = 'Centro de Servicio Sur';

export const R2_VALVULA_DIAMETERS = ['2', '3', '4', '6', '8', '10', '12'] as const;
export const R2_VALVULA_LABELS: Record<string, string> = {
  conduccion: 'CONDUCCIÓN',
  impulsion: 'IMPULSIÓN',
  aduccion: 'ADUCCIÓN',
  bypass: 'BY PASS',
  desague: 'DESAGÜE',
};
export const R2_VALVULA_ROWS = Object.keys(R2_VALVULA_LABELS);

export const R2_CANASTILLA_DIAMETERS = ['2', '3', '4', '6', '8', '10', '14'] as const;
export const R2_CANASTILLA_LABELS: Record<string, string> = {
  aduccion: 'ADUCCION',
  succion: 'SUCCION',
  desague: 'DESAGUE',
};
export const R2_CANASTILLA_ROWS = Object.keys(R2_CANASTILLA_LABELS);

export interface InspeccionItem {
  key: string;
  label: string;
  sub: string;
}

// (clave, descripción, subdescripción) en el orden del formato Reservorios_2.
export const R2_INSPECCION_ITEMS: InspeccionItem[] = [
  { key: 'caja_registro', label: 'CAJA DE REGISTRO', sub: '' },
  { key: 'marco_tapa', label: 'MARCO Y TAPA SANITARIA', sub: '' },
  { key: 'escalera_interior', label: 'ESCALERA', sub: 'INTERIOR' },
  { key: 'escalera_exterior', label: 'ESCALERA', sub: 'EXTERIOR' },
  { key: 'cuba_interior', label: 'CUBA', sub: 'INTERIOR' },
  { key: 'cuba_exterior', label: 'CUBA', sub: 'EXTERIOR' },
  { key: 'loza_fondo', label: 'LOZA DE FONDO', sub: '' },
  { key: 'loza_techo_interior', label: 'LOZA DE TECHO', sub: 'INTERIOR' },
  { key: 'loza_techo_exterior', label: 'LOZA DE TECHO', sub: 'EXTERIOR' },
  { key: 'ducto', label: 'DUCTO DE VENTILACIÓN', sub: '' },
  { key: 'cerco', label: 'CERCO PERIMÉTRICO', sub: '' },
  { key: 'descarga', label: 'DESAGÜE', sub: '' },
];
export const R2_INSPECCION_ROWS = R2_INSPECCION_ITEMS.map((item) => item.key);

export interface DiameterRow {
  diametros: Record<string, number>;
  oper: number;
  no_op: number;
  observaciones: string;
}

interface ReportHeader {
  photo_id: string;
  estacion: string;
  tipo: ReservoirType;
  volumen: number;
  ubicacion: string;
  distrito: string;
  fecha_ejecucion: string;
  suministro: string;
  sgio: string;
  contratista: string;
  cod_infraestructura: string;
}

interface MedidasData {
  largo: string;
  ancho: string;
  diametro: string;
  altura_rebose: string;
  altura_total: string;
  tirante_limpieza: string;
  observacion: string;
}

export interface InspeccionRow {
  normal: boolean;
  critico: boolean;
  observaciones: string;
  sugerencias: string;
}

export interface Reservorios2Row {
  diametros: Record<string, number>;
  oper: number;
  no_op: number;
  observaciones: string;
  sugerencias: string;
}

export interface Reservorios2Medidas {
  diametro: string;
  diametro_interno: string;
  altura_util: string;
  altura_total: string;
  etiqueta_diametro: string;
  etiqueta_diametro_interno: string;
  etiqueta_altura_util: string;
  etiqueta_altura_total: string;
}

export interface Reservorios2Totals {
  oper: number | null;
  no_op: number | null;
}

export interface Reservorios2Data {
  inspeccion: Record<string, InspeccionRow>;
  valvulas: Record<string, Reservorios2Row>;
  canastilla: Record<string, Reservorios2Row>;
  valvulas_totales: Reservorios2Totals;
  canastilla_totales: Reservorios2Totals;
  medidas: Reservorios2Medidas;
}

export interface InformeV2 {
  id: string;
  metadata: { informe_id: number };
  plantilla: PlantillaId;
  header: ReportHeader;
  valvulas: Record<string, DiameterRow>;
  linea: Record<string, DiameterRow>;
  medidas: MedidasData;
  reservorios2: Reservorios2Data;
  status: ReportStatus;
  last_modified: string;
}

export interface InformeV2ListItem {
  id: string;
  metadata: { informe_id: number };
  header: Pick<ReportHeader, 'photo_id' | 'estacion' | 'suministro' | 'distrito'>;
  status: ReportStatus;
}

export interface PhotoAsset {
  name: string;
  src: string;
  file?: File;
}

export function emptyDiameterRow(): DiameterRow {
  return {
    diametros: Object.fromEntries(DIAMETERS.map((d) => [d, 0])),
    oper: 0,
    no_op: 0,
    observaciones: '',
  };
}

export function emptyR2Row(diameters: readonly string[]): Reservorios2Row {
  return {
    diametros: Object.fromEntries(diameters.map((d) => [d, 0])),
    oper: 0,
    no_op: 0,
    observaciones: '',
    sugerencias: '',
  };
}

export function emptyInspeccionRow(): InspeccionRow {
  return { normal: false, critico: false, observaciones: '', sugerencias: '' };
}

export function createEmptyReservorios2(): Reservorios2Data {
  return {
    inspeccion: Object.fromEntries(
      R2_INSPECCION_ROWS.map((key) => [key, emptyInspeccionRow()]),
    ),
    valvulas: Object.fromEntries(
      R2_VALVULA_ROWS.map((key) => [key, emptyR2Row(R2_VALVULA_DIAMETERS)]),
    ),
    canastilla: Object.fromEntries(
      R2_CANASTILLA_ROWS.map((key) => [key, emptyR2Row(R2_CANASTILLA_DIAMETERS)]),
    ),
    valvulas_totales: { oper: null, no_op: null },
    canastilla_totales: { oper: null, no_op: null },
    medidas: {
      diametro: '',
      diametro_interno: '',
      altura_util: '',
      altura_total: '',
      etiqueta_diametro: 'DIAMETRO',
      etiqueta_diametro_interno: 'DIAMETRO INTERNO',
      etiqueta_altura_util: 'ALTURA UTIL',
      etiqueta_altura_total: 'ALTURA TOTAL',
    },
  };
}

export function createEmptyInforme(informeId = 0): InformeV2 {
  const valvulas = Object.fromEntries(VALVULA_ROWS.map((key) => [key, emptyDiameterRow()]));
  const linea = Object.fromEntries(LINEA_ROWS.map((key) => [key, emptyDiameterRow()]));
  return {
    id: `IV2-${String(informeId).padStart(4, '0')}`,
    metadata: { informe_id: informeId },
    plantilla: 'clasica',
    header: {
      photo_id: '',
      estacion: '',
      tipo: 'ELEVADO',
      volumen: 0,
      ubicacion: '',
      distrito: '',
      fecha_ejecucion: '',
      suministro: '',
      sgio: '',
      contratista: '',
      cod_infraestructura: '',
    },
    valvulas,
    linea,
    medidas: {
      largo: '',
      ancho: '',
      diametro: '',
      altura_rebose: '',
      altura_total: '',
      tirante_limpieza: '',
      observacion: '',
    },
    reservorios2: createEmptyReservorios2(),
    status: 'draft',
    last_modified: '',
  };
}

/** Informes guardados antes de la plantilla Reservorios 2 llegan sin esos campos. */
export function normalizeInforme(raw: InformeV2): InformeV2 {
  const base = createEmptyInforme();
  return {
    ...base,
    ...raw,
    plantilla: raw.plantilla === 'reservorios2' ? 'reservorios2' : 'clasica',
    metadata: { ...base.metadata, ...raw.metadata },
    header: { ...base.header, ...raw.header },
    valvulas: { ...base.valvulas, ...raw.valvulas },
    linea: { ...base.linea, ...raw.linea },
    medidas: { ...base.medidas, ...raw.medidas },
    reservorios2: {
      ...base.reservorios2,
      ...raw.reservorios2,
      valvulas_totales: {
        ...base.reservorios2.valvulas_totales,
        ...raw.reservorios2?.valvulas_totales,
      },
      canastilla_totales: {
        ...base.reservorios2.canastilla_totales,
        ...raw.reservorios2?.canastilla_totales,
      },
      medidas: {
        ...base.reservorios2.medidas,
        ...raw.reservorios2?.medidas,
      },
    },
  };
}

export function sumDiameterColumns(
  table: Record<string, DiameterRow>,
  rows: readonly string[],
  diameters: readonly string[] = DIAMETERS,
): Record<string, number> {
  const totals = Object.fromEntries(diameters.map((d) => [d, 0]));
  for (const key of rows) {
    const row = table[key];
    if (!row) continue;
    for (const d of diameters) {
      totals[d] += Number(row.diametros[d] || 0);
    }
  }
  return totals;
}

export function sumOperNoOp(
  table: Record<string, DiameterRow>,
  rows: readonly string[],
): { oper: number; noOp: number } {
  let oper = 0;
  let noOp = 0;
  for (const key of rows) {
    const row = table[key];
    if (!row) continue;
    oper += Number(row.oper || 0);
    noOp += Number(row.no_op || 0);
  }
  return { oper, noOp };
}
