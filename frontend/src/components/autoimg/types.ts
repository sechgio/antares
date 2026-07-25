export type AutoImgTab = 'dashboard' | 'bdimg' | 'arrastre' | 'carpetas' | 'renombrar' | 'logs';

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
  sinSgio?: number;
  carpetasActivas?: number;
}

export interface DriveFolderThumb {
  id: string;
  name: string;
  dataUrl: string | null;
}

export interface DriveVerifyResult {
  accessible: boolean;
  folder_id: string;
  name: string;
  /** Exact when has_more is false; otherwise a lower bound from the first page. */
  image_count: number;
  /** True when more images exist beyond image_count (verify uses a single page). */
  has_more?: boolean;
  sample_files: string[];
}