export type ReportStatus = 'draft' | 'completed';
export type ReservoirType = 'ELEVADO' | 'ENTERRADO' | 'SEMIENTERRADO' | 'APOYADO' | 'CISTERNA';

export const DIAMETERS = ['2', '4', '6', '8', '10', '12', '14', '16'] as const;
export type Diameter = (typeof DIAMETERS)[number];

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

export interface DiameterRow {
  diametros: Record<string, number>;
  oper: number;
  no_op: number;
  observaciones: string;
}

export interface ReportHeader {
  photo_id: string;
  estacion: string;
  tipo: ReservoirType;
  volumen: number;
  ubicacion: string;
  distrito: string;
  fecha_ejecucion: string;
  suministro: string;
  sgio: string;
}

export interface MedidasData {
  largo: string;
  ancho: string;
  diametro: string;
  altura_rebose: string;
  altura_total: string;
  tirante_limpieza: string;
  observacion: string;
}

export interface InformeV2 {
  id: string;
  metadata: { informe_id: number };
  header: ReportHeader;
  valvulas: Record<string, DiameterRow>;
  linea: Record<string, DiameterRow>;
  medidas: MedidasData;
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
  /** Kept for PDF export through staged file tokens. */
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

export function sumDiameterColumns(
  table: Record<string, DiameterRow>,
  rows: readonly string[],
): Record<string, number> {
  const totals = Object.fromEntries(DIAMETERS.map((d) => [d, 0]));
  for (const key of rows) {
    const row = table[key];
    if (!row) continue;
    for (const d of DIAMETERS) {
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
