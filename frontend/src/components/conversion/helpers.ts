import { RenamePattern } from '../../types';

export const VIDEO_EXTENSIONS = new Set(['.mp4', '.avi', '.mov', '.mkv', '.wmv', '.flv', '.webm', '.m4v', '.3gp', '.mpg', '.mpeg']);

export const isVideoByExt = (path: string) => {
  const ext = path.slice(path.lastIndexOf('.')).toLowerCase();
  return VIDEO_EXTENSIONS.has(ext);
};

export const DEFAULT_FORMATS = ['JPEG', 'PNG', 'WEBP', 'TIFF'];
export const DEFAULT_FIELDS = ['codigo', 'nombre'];
export const DEFAULT_PATTERN = '{codigo}_{nombre}_{seq}{ext}';

export const buildDefaultPresets = (fields: string[]): RenamePattern[] => {
  const codeField = fields[0];
  const nameField = fields[1];
  const codeNamePattern = codeField && nameField ? `{${codeField}}_{${nameField}}_{seq}{ext}` : codeField ? `{${codeField}}_{seq}{ext}` : 'img_{seq}{ext}';
  const codeSeqPattern = codeField ? `{${codeField}}_{seq}{ext}` : 'img_{seq}{ext}';
  return [
    { id: 'code_name', label: 'BD + número', pattern: codeNamePattern },
    { id: 'code_seq', label: 'Código + número', pattern: codeSeqPattern },
    { id: 'sequential', label: 'IMG + número', pattern: 'img_{seq}{ext}' },
    { id: 'keep', label: 'Mantener nombres', pattern: '' },
  ];
};

export const buildColumnPresets = (columns: string[]): RenamePattern[] => {
  if (columns.length === 0) return [];
  const first = columns[0];
  const second = columns[1];
  const presets: RenamePattern[] = [];

  if (columns.length >= 2) {
    presets.push({ id: `col_${first}_${second}`, label: `${first} + ${second}`, pattern: `{${first}}_{${second}}_{seq}{ext}` });
  }
  presets.push({ id: `col_${first}`, label: `${first} + seq`, pattern: `{${first}}_{seq}{ext}` });

  for (const col of columns) {
    presets.push({ id: `col_only_${col}`, label: col, pattern: `{${col}}{ext}` });
  }

  return presets;
};

export const parsePositiveInt = (value: string) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};
