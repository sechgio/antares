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

export const DEFAULT_SGIO_LABEL = 'SGIO';
export const DEFAULT_TITULO_LINEA1 = 'Limpieza y Desinfección de Reservorios y Cisternas';
export const DEFAULT_TITULO_LINEA2 = 'Centro de Servicio Villa El Salvador';

export interface ReportHeader {
  cs: string;
  contratista: string;
  sgio: string;
  sgio_label: string;
  titulo_linea1: string;
  titulo_linea2: string;
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
  observaciones_caja_registro: string;
  sugerencias_caja_registro: string;
  observaciones_marco_tapa: string;
  sugerencias_marco_tapa: string;
  observaciones_escalera_int: string;
  sugerencias_escalera_int: string;
  observaciones_escalera_ext: string;
  sugerencias_escalera_ext: string;
  observaciones_cuba_int: string;
  sugerencias_cuba_int: string;
  observaciones_cuba_ext: string;
  sugerencias_cuba_ext: string;
  observaciones_loza_fondo: string;
  sugerencias_loza_fondo: string;
  observaciones_loza_techo_int: string;
  sugerencias_loza_techo_int: string;
  observaciones_loza_techo_ext: string;
  sugerencias_loza_techo_ext: string;
  observaciones_ducto: string;
  sugerencias_ducto: string;
  observaciones_cerco: string;
  sugerencias_cerco: string;
  observaciones_descarga: string;
  sugerencias_descarga: string;
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

export const DEFAULT_MEDIDA_LABEL_DIAMETRO = 'DIAMETRO';
export const DEFAULT_MEDIDA_LABEL_DIAMETRO_INTERNO = 'DIAMETRO INTERNO';

export interface MedidasData {
  [key: string]: string;
  diametro: string;
  diametro_interno: string;
  altura_util: string;
  altura_total: string;
  etiqueta_diametro: string;
  etiqueta_diametro_interno: string;
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
