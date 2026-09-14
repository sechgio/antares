
import { stageAndParseSpreadsheet } from '../../../utils/spreadsheet';

export async function parseSpreadsheetFile(file: File): Promise<{ headers: string[]; rows: Record<string, string>[] }> {
  const res = await stageAndParseSpreadsheet(file);
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
