/** Excel/CSV parsing for Canvas generate mode (module-local, no Generador imports). */

export async function parseSpreadsheetFile(file: File): Promise<{ headers: string[]; rows: Record<string, string>[] }> {
  const XLSX = await import('xlsx');
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return { headers: [], rows: [] };
  const sheet = workbook.Sheets[sheetName];
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '', raw: false });
  if (!raw.length) return { headers: [], rows: [] };
  const headers = Object.keys(raw[0]);
  const rows = raw.map((row) => {
    const out: Record<string, string> = {};
    for (const header of headers) {
      const value = row[header];
      out[header] = value == null ? '' : String(value);
    }
    return out;
  });
  return { headers, rows };
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
