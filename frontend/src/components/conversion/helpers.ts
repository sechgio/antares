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

const nameStem = (name: string) =>
  name.includes('.') ? name.slice(0, name.lastIndexOf('.')) : name;

type MappingLookupIndex = {
  exact: Map<string, string>;
  lower: Map<string, string>;
  conflictedStems: Set<string>;
  conflictedStemsLower: Set<string>;
};

export const buildMappingLookupIndex = (mapping: Record<string, string>): MappingLookupIndex => {
  const exact = new Map<string, string>();
  const lower = new Map<string, string>();
  const conflictedStems = new Set<string>();
  const conflictedStemsLower = new Set<string>();
  const stemToValues = new Map<string, Set<string>>();
  const stemLowerToValues = new Map<string, Set<string>>();

  for (const [key, value] of Object.entries(mapping)) {
    if (!key) continue;
    exact.set(key, value);
    lower.set(key.toLowerCase(), value);
    const stem = nameStem(key);
    if (!stem) continue;
    let values = stemToValues.get(stem);
    if (!values) {
      values = new Set();
      stemToValues.set(stem, values);
    }
    values.add(value);
    const stemL = stem.toLowerCase();
    let lowerValues = stemLowerToValues.get(stemL);
    if (!lowerValues) {
      lowerValues = new Set();
      stemLowerToValues.set(stemL, lowerValues);
    }
    lowerValues.add(value);
  }

  for (const [stem, values] of stemToValues) {
    if (values.size !== 1) {
      conflictedStems.add(stem);
      conflictedStemsLower.add(stem.toLowerCase());
      continue;
    }
    const value = values.values().next().value as string;
    if (!exact.has(stem)) exact.set(stem, value);
  }

  for (const [stemL, values] of stemLowerToValues) {
    if (values.size !== 1) {
      conflictedStemsLower.add(stemL);
      continue;
    }
    const value = values.values().next().value as string;
    if (!lower.has(stemL)) lower.set(stemL, value);
  }

  return { exact, lower, conflictedStems, conflictedStemsLower };
};

const lookupWithIndex = (index: MappingLookupIndex, fileName: string): string | undefined => {
  const name = fileNameFromPath(fileName);
  const stem = nameStem(name);
  if (index.exact.has(name)) return index.exact.get(name);
  const lowerName = name.toLowerCase();
  if (index.lower.has(lowerName)) return index.lower.get(lowerName);
  if (index.conflictedStems.has(stem) || index.conflictedStemsLower.has(stem.toLowerCase())) {
    return undefined;
  }
  if (index.exact.has(stem)) return index.exact.get(stem);
  const lowerStem = stem.toLowerCase();
  if (index.lower.has(lowerStem)) return index.lower.get(lowerStem);
  return undefined;
};

export const lookupMappingValue = (mapping: Record<string, string>, fileName: string): string | undefined =>
  lookupWithIndex(buildMappingLookupIndex(mapping), fileName);

export const resolveMappedOutputName = (mapping: Record<string, string>, fileName: string): string | null => {
  const index = buildMappingLookupIndex(mapping);
  const raw = lookupWithIndex(index, fileName);
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
  const index = buildMappingLookupIndex(mapping);
  const grouped = new Map<string, { output: string; sources: string[] }>();
  for (const filePath of files) {
    const name = fileNameFromPath(filePath);
    const raw = lookupWithIndex(index, name);
    if (!raw) continue;
    const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')).toLowerCase() : '';
    let output = sanitizeOutputStem(raw);
    if (!output) continue;
    if (ext && !output.toLowerCase().endsWith(ext)) output += ext;
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
  const index = buildMappingLookupIndex(mapping);
  const fileNames = files.map(fileNameFromPath);
  const matchedNames = fileNames.filter((name) => lookupWithIndex(index, name) !== undefined);
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

export const pickSyncedKeyColumn = (current: string, columns: string[]) => {
  if (current && columns.includes(current)) return current;
  return columns[0] ?? '';
};

const normalizeColumnName = (name: string) => {
  const text = name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return text.replace(/[\s_\-]+/g, ' ').trim().replace(/\s+/g, ' ');
};

export const isMappingSchemaMismatch = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = normalizeColumnName(message);
  return [
    'al menos 2 columnas',
    'no se detecto una columna id',
    'no se detecto una columna de nuevo nombre',
  ].some((fragment) => normalized.includes(fragment));
};

export const parsePositiveInt = (value: string) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};
