export type AutoImgTab = 'dashboard' | 'bdimg' | 'arrastre' | 'carpetas' | 'scan' | 'logs';

export interface ArrastreEntry {
  nis: string;
  sgio: string;
  motivo: string;
  fecha: string;
  observacion: string;
}

export interface AutoImgFolder {
  name: string;
  folder_id: string;
  activo: boolean;
  ultimo_scan: string;
  cant_archivos: number;
}

export interface AutoImgStatus {
  connected: boolean;
  sheetName?: string;
  sheetId?: string;
  sheetLinked?: boolean;
  lastSync?: string;
  autoSync: boolean;
  totalNis?: number;
  completos?: number;
  faltantes?: number;
  sobrantes?: number;
  carpetasActivas?: number;
}

export interface AutoImgBootstrap extends AutoImgStatus {
  folders: AutoImgFolder[];
  bdRows: string[][];
  logRows: string[][];
  arrastre: ArrastreEntry[];
  cached?: boolean;
}

export interface ScanFolderSummary {
  name: string;
  folder_id?: string;
  count: number;
  nis_found: number;
  error?: string;
}

export interface ScanNisResult {
  nis: string;
  count: number;
  folders: string[];
  estado: string;
}

export interface ScanResults {
  folder_summary: ScanFolderSummary[];
  nis_results: ScanNisResult[];
}

export interface ScanSummary {
  total: number;
  completos: number;
  faltantes: number;
  sobrantes: number;
  sin_sgio: number;
}

export interface DriveVerifyResult {
  accessible: boolean;
  folder_id: string;
  name: string;
  image_count: number;
  sample_files: string[];
}