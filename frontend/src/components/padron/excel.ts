/**
 * Utilidades para parsear archivos Excel del padron
 */
import type { HeaderData, PadronItem, ParseResult, ExcelRecord, OutputFormat, WaterCutItem } from './data';
import {
  FIELD_ALIASES,
  ITEM_FIELD_ALIASES,
  DATE_FIELDS,
  WATER_CUT_DATE_FIELDS,
  WATER_CUT_FIELD_ALIASES,
  WATER_CUT_ITEM_FIELD_ALIASES,
  toDisplayDate,
  createDefaultHeaderData,
  createDefaultWaterCutData,
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

function mapHeaderRow(
  row: Record<string, unknown>,
  outputFormat: OutputFormat,
): HeaderData {
  const data = outputFormat === 'water-cut-notice'
    ? createDefaultWaterCutData()
    : createDefaultHeaderData();
  const aliases = outputFormat === 'water-cut-notice'
    ? WATER_CUT_FIELD_ALIASES
    : FIELD_ALIASES;
  const dateFields = outputFormat === 'water-cut-notice'
    ? WATER_CUT_DATE_FIELDS
    : DATE_FIELDS;
  Object.entries(row).forEach(([col, value]) => {
    const key = matchKey(col, aliases);
    if (key) {
      const raw = String(value ?? '').trim();
      data[key] = dateFields.has(key) ? toDisplayDate(raw) : raw;
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

function mapWaterCutItems(rows: Record<string, unknown>[]): WaterCutItem[] {
  return rows
    .map((row, idx) => {
      const mapped: Record<string, string> = {};
      Object.entries(row).forEach(([col, value]) => {
        const key = matchKey(col, WATER_CUT_ITEM_FIELD_ALIASES);
        if (key) {
          const raw = String(value ?? '').trim();
          mapped[key] = WATER_CUT_DATE_FIELDS.has(key) ? toDisplayDate(raw) : raw;
        }
      });
      if (!Object.keys(mapped).length) return null;
      return {
        item: idx + 1,
        hora: mapped.hora ?? '',
        fecha: mapped.fecha ?? '',
        nombresApellidos: mapped.nombresApellidos ?? '',
        direccion: mapped.direccion ?? '',
        dni: mapped.dni ?? '',
        firma: mapped.firma ?? '',
        observaciones: mapped.observaciones ?? '',
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null) as WaterCutItem[];
}

function detectRecords(
  sheetMap: Record<string, Record<string, unknown>[]>,
  outputFormat: OutputFormat,
): ExcelRecord[] {
  const records: ExcelRecord[] = [];
  const aliases = outputFormat === 'water-cut-notice'
    ? WATER_CUT_FIELD_ALIASES
    : FIELD_ALIASES;
  Object.entries(sheetMap).forEach(([name, rows]) => {
    rows.forEach((row, idx) => {
      const hasMatch = Object.keys(row).some((col) => matchKey(col, aliases));
      if (hasMatch) {
        records.push({
          id: `${name}-${idx}`,
          label: `${name} - Fila ${idx + 2}`,
          sheetName: name,
          rowIndex: idx,
          data: mapHeaderRow(row, outputFormat),
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

function detectWaterCutItems(sheetMap: Record<string, Record<string, unknown>[]>): WaterCutItem[] {
  const allRows = Object.values(sheetMap).flat();
  return mapWaterCutItems(allRows);
}

export async function parseWorkbook(
  file: File,
  outputFormat: OutputFormat = 'service-interruption',
): Promise<ParseResult> {
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

  const records = detectRecords(sheetMap, outputFormat);
  const importedItems = detectItems(sheetMap);
  const importedWaterCutItems = detectWaterCutItems(sheetMap);

  return {
    workbookName: file.name,
    records: records.length
      ? records
      : [{
          id: 'manual-0',
          label: 'Manual',
          sheetName: 'Manual',
          rowIndex: 0,
          data: outputFormat === 'water-cut-notice'
            ? createDefaultWaterCutData()
            : createDefaultHeaderData(),
        }],
    importedItems,
    importedWaterCutItems,
  };
}
