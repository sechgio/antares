/**
 * Utilidades para parsear archivos Excel del padron
 */
import type { HeaderData, PadronItem, ParseResult, ExcelRecord } from './data';
import {
  FIELD_ALIASES,
  ITEM_FIELD_ALIASES,
  DATE_FIELDS,
  toDisplayDate,
  createDefaultHeaderData,
} from './data';

function normalize(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function matchKey(headerText: string, aliasMap: Record<string, string[]>): string | undefined {
  const norm = normalize(headerText);
  return Object.entries(aliasMap).find(([, aliases]) =>
    aliases.some((alias) => normalize(alias) === norm)
  )?.[0];
}

function mapHeaderRow(row: Record<string, unknown>): HeaderData {
  const data = createDefaultHeaderData();
  Object.entries(row).forEach(([col, value]) => {
    const key = matchKey(col, FIELD_ALIASES);
    if (key) {
      const raw = String(value ?? '').trim();
      data[key] = DATE_FIELDS.has(key) ? toDisplayDate(raw) : raw;
    }
  });
  return data;
}

function mapItems(rows: Record<string, unknown>[]): PadronItem[] {
  return rows
    .map((row, idx) => {
      const mapped: Record<string, string> = {};
      Object.entries(row).forEach(([col, value]) => {
        const key = matchKey(col, ITEM_FIELD_ALIASES);
        if (key) mapped[key] = String(value ?? '').trim();
      });
      if (!Object.keys(mapped).length) return null;
      return {
        item: Number(mapped.item) || idx + 1,
        nombresApellidos: mapped.nombresApellidos ?? '',
        direccion: mapped.direccion ?? '',
        horaComunicacion: mapped.horaComunicacion ?? '',
        firmaSuministro: mapped.firmaSuministro ?? '',
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null) as PadronItem[];
}

function detectRecords(sheetMap: Record<string, Record<string, unknown>[]>): ExcelRecord[] {
  const records: ExcelRecord[] = [];
  Object.entries(sheetMap).forEach(([name, rows]) => {
    rows.forEach((row, idx) => {
      const hasMatch = Object.keys(row).some((col) => matchKey(col, FIELD_ALIASES));
      if (hasMatch) {
        records.push({
          id: `${name}-${idx}`,
          label: `${name} - Fila ${idx + 2}`,
          sheetName: name,
          rowIndex: idx,
          data: mapHeaderRow(row),
        });
      }
    });
  });
  return records;
}

function detectItems(sheetMap: Record<string, Record<string, unknown>[]>): PadronItem[] {
  const allRows = Object.values(sheetMap).flat();
  return mapItems(allRows);
}

export async function parseWorkbook(file: File): Promise<ParseResult> {
  const XLSX = await import('xlsx');
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });

  const sheetMap: Record<string, Record<string, unknown>[]> = {};
  workbook.SheetNames.forEach((name: string) => {
    sheetMap[name] = XLSX.utils.sheet_to_json(workbook.Sheets[name], {
      defval: '',
      raw: false,
    });
  });

  const records = detectRecords(sheetMap);
  const importedItems = detectItems(sheetMap);

  return {
    workbookName: file.name,
    records: records.length
      ? records
      : [{
          id: 'manual-0',
          label: 'Manual',
          sheetName: 'Manual',
          rowIndex: 0,
          data: createDefaultHeaderData(),
        }],
    importedItems,
  };
}
