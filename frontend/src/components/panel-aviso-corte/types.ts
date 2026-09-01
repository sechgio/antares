export type MatchStrategy = 'prefix' | 'contains' | 'exact' | 'regex';

export interface LogoAsset {
  file: File;
  objectUrl: string;
}

export interface LocalImage {
  file: File;
  objectUrl: string;
}

export interface ExcelRow {
  [column: string]: string;
}

export interface ExcelSource {
  filename: string;
  columns: string[];
  normalizedColumns: string[];
  rows: ExcelRow[];
  warnings: string[];
}

export interface MatchRule {
  keyColumn: string;
  strategy: MatchStrategy;
  regexPattern?: string;
}

export interface PanelImageRefVM {
  filename: string;
  caption: string;
  position: number;
}

export interface PanelVM {
  cuadrante: string;
  fechaCorte: string;
  motivo: string;
  imagenes: PanelImageRefVM[];
  sourceRowIndex: number | null;
}

export interface MatchSummary {
  totalRows: number;
  rowsWithImages: number;
  rowsWithoutImages: number;
  totalImages: number;
  matchedImages: number;
  unmatchedImages: number;
  unmatchedImageNames: string[];
  rowsWithoutImagesKeys: string[];
}

export interface MatchResult {
  panels: PanelVM[];
  summary: MatchSummary;
  warnings: string[];
}

export interface HeaderFormState {
  cuadrante: string;
  fechaCorte: string;
  motivo: string;
}

/** IPC wire shape from panel_aviso_corte_compute_match (snake_case). */
export interface PanelMatchImageRefResponse {
  filename: string;
  caption: string;
  position: number;
}

export interface PanelMatchPanelResponse {
  cuadrante: string;
  fecha_corte: string;
  motivo: string;
  imagenes: PanelMatchImageRefResponse[];
  source_row_index: number | null;
}

export interface PanelMatchSummaryResponse {
  total_rows: number;
  rows_with_images: number;
  rows_without_images: number;
  total_images: number;
  matched_images: number;
  unmatched_images: number;
  unmatched_image_names: string[];
  rows_without_images_keys: string[];
}

export interface PanelMatchResponse {
  panels: PanelMatchPanelResponse[];
  summary: PanelMatchSummaryResponse;
  warnings: string[];
}
