export interface ProcessStatus {
  running: boolean;
  progress: number;
  current_file: string;
  ok_count: number;
  err_count: number;
  logs: LogEntry[];
  id?: string;
  job_type?: string;
  total?: number;
  cancel_requested?: boolean;
  created_at?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown> | null;
}

export interface LogEntry {
  message: string;
  tag: string;
}

export interface PreviewItem {
  origen: string;
  nuevo: string;
  en_bd: boolean;
}

export interface DBField {
  name: string;
  type: string;
  required: boolean;
  unique: boolean;
}

export interface RenamePattern {
  id: string;
  label: string;
  pattern: string;
}

export interface DBRecord {
  [key: string]: string | number | null;
}

export interface ThemeConfig {
  [key: string]: string;
  name: string;
  bg: string;
  bg_secondary: string;
  fg: string;
  fg_muted: string;
  fg_secondary: string;
  fg_tertiary: string;
  accent: string;
  accent_light: string;
  accent_hover: string;
  accent_dark: string;
  border: string;
  blue_hover: string;
  error: string;
  warning: string;
  success: string;
  orange: string;
}

export interface VisualMapping {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  font_size: number;
  font_name: string;
  color_r: number;
  color_g: number;
  color_b: number;
  padding: number;
  blank_x: number | null;
  blank_y: number | null;
  blank_width: number | null;
  blank_height: number | null;
  redraw_top_border: boolean;
  redraw_ot_badge: boolean;
  blank_mcids: number[] | null;
}

export type FormatOrigin = 'builtin' | 'uploaded';
export type MappingStrategy = 'legacy_xobject' | 'visual_overlay' | 'simple_overlay';

export interface FormatInfo {
  id: string;
  nombre: string;
  origen: FormatOrigin;
  enabled: boolean;
  persisted: boolean;
  strategy: MappingStrategy;
  mapping: VisualMapping | null;
  filename_pattern: string;
  max_pages: number;
  number_min: number;
  number_max: number;
  has_mapping: boolean;
}
