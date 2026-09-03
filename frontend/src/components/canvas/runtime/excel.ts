
import { stageFileForIpc } from '../../../utils/stageFile';

export async function parseSpreadsheetFile(file: File): Promise<{ headers: string[]; rows: Record<string, string>[] }> {
  const { api } = await import('../../../api');
  const ext = file.name.toLowerCase().split('.').pop() || '';
  const formatHint = ['xlsx', 'xls', 'csv'].includes(ext) ? ext : undefined;
  const fileToken = await stageFileForIpc(file);
  const res = await api.spreadsheetParse({ file_token: fileToken, format_hint: formatHint });
  const withData = res.sheets.find(s => s.rows.length > 1);
  const sh = withData ?? res.sheets.find(s => s.rows.length > 0);
  if (!sh || !sh.rows.length) return { headers: [], rows: [] };
  const header = (sh.rows[0] as unknown[]).map(v => String(v ?? ''));
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < sh.rows.length; i++) {
    const arr = sh.rows[i] as unknown[];
    const obj: Record<string, string> = {};
    header.forEach((h, idx) => {
      obj[h] = arr[idx] == null ? '' : String(arr[idx]);
    });
    rows.push(obj);
  }
  return { headers: header, rows };
}

export function imageNameCandidates(filename: string): string[] {
  const base = filename.replace(/\.[^.]+$/, '');
  const numbered = base.match(/^(.*)[-_]\d+$/);
  return numbered ? [base, numbered[1]] : [base];
}

export function matchesRecordId(filename: string, recordId: string): boolean {
  const id = normalizeRecordId(recordId);
  if (!id) return false;
  return imageNameCandidates(filename).some((candidate) => normalizeRecordId(candidate) === id);
}

export function naturalSortByName(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

export function normalizeRecordId(recordId: string): string {
  return String(recordId).trim().toLocaleLowerCase();
}

export function buildImagesByRecordId(
  rows: Record<string, string>[],
  idColumn: string,
  images: File[],
): Map<string, File[]> {
  const recordIds = new Set(
    rows.map((row) => normalizeRecordId(row[idColumn] || '')).filter(Boolean),
  );
  const index = new Map<string, File[]>();
  if (!idColumn || recordIds.size === 0) return index;

  for (const image of images) {
    const keys = new Set(imageNameCandidates(image.name).map(normalizeRecordId));

    for (const key of keys) {
      if (!recordIds.has(key)) continue;
      const matched = index.get(key);
      if (matched) matched.push(image);
      else index.set(key, [image]);
    }
  }

  for (const matched of index.values()) {
    matched.sort((a, b) => naturalSortByName(a.name, b.name));
  }
  return index;
}

export function buildRowData(
  row: Record<string, string>,
  mappings: Record<string, string>,
): Record<string, string> {
  const data: Record<string, string> = { ...row };
  for (const [fieldKey, column] of Object.entries(mappings)) {
    if (!column) continue;
    const value = row[column] ?? '';
    data[fieldKey] = value;
    data[fieldKey.toUpperCase()] = value;
  }
  return data;
}
