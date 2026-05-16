export type MatchStrategy = 'prefix' | 'contains' | 'exact' | 'regex';
export type ExportMode = 'skip_empty' | 'include_empty';

export interface LogoAsset {
  file: File;
  objectUrl: string;
}

export interface LocalImage {
  file: File;
  objectUrl: string;
  localPath?: string;
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
