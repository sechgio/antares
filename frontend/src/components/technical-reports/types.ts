export type CheckState = 'normal' | 'critico' | 'unchecked';
export type ReportStatus = 'draft' | 'completed';
export type ReservoirType = 'ELEVADO' | 'ENTERRADO' | 'SEMIENTERRADO' | 'APOYADO' | 'CISTERNA';

export interface ReportMetadata {
  informe_id: number;
  dia: number;
  mes: string;
  anio: number;
  pagina: string;
}

export interface ReportHeader {
  cs: string;
  contratista: string;
  sgio: string;
  codigo_infraestructura: string;
  ubicacion: string;
  suministro: string;
  tipo: ReservoirType;
  volumen: number;
}

export interface InspeccionDescripcion {
  [key: string]: CheckState | string;
  caja_registro: CheckState;
  marco_tapa: CheckState;
  escalera_interior: CheckState;
  escalera_exterior: CheckState;
  cuba_interior: CheckState;
  cuba_exterior: CheckState;
  loza_fondo: CheckState;
  loza_techo_interior: CheckState;
  loza_techo_exterior: CheckState;
  ducto_ventilacion: CheckState;
  cerco_perimetrico: CheckState;
  descarga: CheckState;
}

export interface DiameterMap {
  [diameter: string]: number;
}

export interface ValvulasData {
  [key: string]: DiameterMap | number | string;
  diametros: DiameterMap;
  impulsion: DiameterMap;
  aduccion: DiameterMap;
  bypass: DiameterMap;
  desague: DiameterMap;
  operativas: number;
  no_operativas: number;
  observaciones_conduccion: string;
  sugerencias_conduccion: string;
  observaciones_impulsion: string;
  sugerencias_impulsion: string;
  observaciones_aduccion: string;
  sugerencias_aduccion: string;
  observaciones_bypass: string;
  sugerencias_bypass: string;
  observaciones_desague: string;
  sugerencias_desague: string;
}

export interface CanastillasData {
  [key: string]: DiameterMap | number | string;
  diametros: DiameterMap;
  aduccion: DiameterMap;
  succion: DiameterMap;
  desague: DiameterMap;
  operativas: number;
  no_operativas: number;
  observaciones_aduccion: string;
  sugerencias_aduccion: string;
  observaciones_succion: string;
  sugerencias_succion: string;
  observaciones_desague: string;
  sugerencias_desague: string;
}

export interface MedidasData {
  [key: string]: string;
  diametro: string;
  diametro_interno: string;
  altura_util: string;
  altura_total: string;
}

export interface TechnicalReport {
  id: string;
  metadata: ReportMetadata;
  header: ReportHeader;
  inspeccion: InspeccionDescripcion;
  valvulas: ValvulasData;
  canastillas: CanastillasData;
  medidas: MedidasData;
  observaciones: string;
  sugerencias: string;
  status: ReportStatus;
  last_modified: string;
}

export interface TechnicalReportListItem {
  id: string;
  metadata: Pick<ReportMetadata, 'informe_id'>;
  header: Pick<ReportHeader, 'cs' | 'codigo_infraestructura'>;
  status: ReportStatus;
}
