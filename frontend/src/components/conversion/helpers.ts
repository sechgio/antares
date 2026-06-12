import { MappingCollision, MappingResult, RenamePattern } from '../../types';

export const VIDEO_EXTENSIONS = new Set(['.mp4', '.avi', '.mov', '.mkv', '.wmv', '.flv', '.webm', '.m4v', '.3gp', '.mpg', '.mpeg']);

export type RenameSource = 'none' | 'catalog' | 'mapping';

export const isVideoByExt = (path: string) => {
  const ext = path.slice(path.lastIndexOf('.')).toLowerCase();
  return VIDEO_EXTENSIONS.has(ext);
};

export const DEFAULT_FORMATS = ['JPEG', 'PNG', 'WEBP', 'TIFF'];
export const DEFAULT_FIELDS = ['codigo', 'nombre'];
export const DEFAULT_PATTERN = '{codigo}_{nombre}_{seq}{ext}';

export const fileNameFromPath = (path: string) => path.split(/[\\/]/).pop() || path;

const sanitizeOutputStem = (value: string) =>
  value
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/[\x00-\x1F\x7F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .replace(/^[_\. ]+|[_\. ]+$/g, '');

export const lookupMappingValue = (mapping: Record<string, string>, fileName: string): string | undefined => {
  const name = fileNameFromPath(fileName);
  const stem = name.includes('.') ? name.slice(0, name.lastIndexOf('.')) : name;
  if (mapping[name] !== undefined) return mapping[name];
  if (mapping[stem] !== undefined) return mapping[stem];

  const lowerEntries = Object.entries(mapping).map(([key, value]) => [key.toLowerCase(), value] as const);
  const lowerName = name.toLowerCase();
  const lowerStem = stem.toLowerCase();
  for (const [key, value] of lowerEntries) {
    if (key === lowerName || key === lowerStem) return value;
  }
  return undefined;
};

export const resolveMappedOutputName = (mapping: Record<string, string>, fileName: string): string | null => {
  const raw = lookupMappingValue(mapping, fileName);
  if (!raw) return null;
  const name = fileNameFromPath(fileName);
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')).toLowerCase() : '';
  let output = sanitizeOutputStem(raw);
  if (!output) return null;
  if (ext && !output.toLowerCase().endsWith(ext)) output += ext;
  return output;
};

const mappingIdMatchesFile = (idKey: string, fileName: string) => {
  const keyLower = idKey.toLowerCase();
  const stemKey = idKey.includes('.') ? idKey.slice(0, idKey.lastIndexOf('.')).toLowerCase() : idKey.toLowerCase();
  if (fileName === idKey || fileName.toLowerCase() === keyLower) return true;
  const fileStem = fileName.includes('.') ? fileName.slice(0, fileName.lastIndexOf('.')) : fileName;
  return fileStem === idKey || fileStem.toLowerCase() === stemKey || fileStem.toLowerCase() === keyLower;
};

export const findMappingCollisions = (
  mapping: Record<string, string>,
  files: string[],
): MappingCollision[] => {
  const grouped = new Map<string, { output: string; sources: string[] }>();
  for (const filePath of files) {
    const name = fileNameFromPath(filePath);
    const output = resolveMappedOutputName(mapping, name);
    if (!output) continue;
    const key = output.toLowerCase();
    const existing = grouped.get(key);
    if (existing) {
      existing.sources.push(name);
    } else {
      grouped.set(key, { output, sources: [name] });
    }
  }
  return Array.from(grouped.values()).filter((entry) => entry.sources.length > 1);
};

export const computeMappingStats = (
  mapping: Record<string, string>,
  files: string[],
): MappingResult => {
  const fileNames = files.map(fileNameFromPath);
  const matchedNames = fileNames.filter((name) => lookupMappingValue(mapping, name) !== undefined);
  const orphanEntries = Object.keys(mapping).filter(
    (idKey) => !fileNames.some((name) => mappingIdMatchesFile(idKey, name)),
  );
  const collisions = findMappingCollisions(mapping, files);

  return {
    mapping,
    totalEntries: Object.keys(mapping).length,
    matchedFiles: matchedNames.length,
    unmatchedFiles: fileNames.filter((name) => !matchedNames.includes(name)),
    orphanEntries,
    collisions,
  };
};

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

export const pickSyncedKeyColumn = (current: string, columns: string[]) => {
  if (current && columns.includes(current)) return current;
  return columns[0] ?? '';
};

const normalizeColumnName = (name: string) =>
  name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

export const detectMappingMode = (columns: string[]): boolean => {
  if (columns.length !== 2) return false;
  const normalized = columns.map(normalizeColumnName);
  const set = new Set(normalized);
  return set.has('id') && (set.has('renombre') || set.has('rename'));
};

export const parsePositiveInt = (value: string) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};