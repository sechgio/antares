/** Excel/CSV parsing for Canvas generate mode (module-local, no Generador imports). */

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


/** Match image filenames like `{recordId}-1.jpg` or `{recordId}_2.png`. */
export function matchesRecordId(filename: string, recordId: string): boolean {
  const base = filename.replace(/\.[^.]+$/, '');
  const id = String(recordId).trim();
  if (!id) return false;
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped}(?:[-_]\\d+)?$`, 'i').test(base);
}

export function naturalSortByName(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
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
