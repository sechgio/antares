import { REPORT_FIELDS } from "../constants";
import { formatExcelSerialDMY } from "../../../utils/excel";
import { isDateColumn } from "../utils";
import {
  matchesRecordId,
  naturalSortFilesByName,
} from "../../../utils/recordMatching";

export interface SheetRows {
  name: string;
  rows: unknown[][];
  rowCount?: number;
}

/** Auto-mapeo de columnas del Excel a campos del reporte por id/label. */
export function computeAutoMappings(headers: string[]): {
  mappings: Record<string, string>;
  idColumn: string;
} {
  const mappings: Record<string, string> = {};
  REPORT_FIELDS.forEach((field) => {
    const match = headers.find(
      (h) =>
        h.toLowerCase().includes(field.id) ||
        h.toLowerCase().includes(field.label.toLowerCase()),
    );
    if (match) mappings[field.id] = match;
  });
  return { mappings, idColumn: headers[0] || "" };
}

/**
 * Convierte filas crudas de hoja en {headers, data} aplicando trim de
 * cabeceras y conversión de seriales Excel en columnas de fecha.
 * Devuelve `{ error }` con el mensaje exacto mostrado al usuario.
 */
export function rowsToRecords(
  rows: unknown[][],
): { headers: string[]; data: Record<string, unknown>[] } | { error: string } {
  if (!rows.length) {
    return { error: "El archivo está vacío o no tiene filas con datos" };
  }
  const headers = (rows[0] ?? []).map((v) => String(v ?? "").trim());
  if (headers.every((h) => !h)) {
    return { error: "El archivo no tiene cabeceras válidas" };
  }
  const data = rows.slice(1).map((row) => {
    const obj: Record<string, unknown> = {};
    headers.forEach((h, i) => {
      if (!h) return;
      let cellValue = row[i];
      if (
        isDateColumn(h) &&
        typeof cellValue === "number" &&
        cellValue > 1000 &&
        cellValue < 100000
      ) {
        cellValue = formatExcelSerialDMY(cellValue);
      }
      obj[h] = cellValue;
    });
    return obj;
  });
  if (data.length === 0) {
    return { error: "El archivo no contiene filas de datos" };
  }
  return { headers, data };
}

/** Hoja preferida: primera con datos reales; si no, primera no vacía. */
export function pickSheetToLoad(sheets: SheetRows[]): SheetRows | undefined {
  const rowLen = (s: SheetRows) =>
    s.rows.length > 0 ? s.rows.length : (s.rowCount ?? 0);
  const withData = sheets.filter((s) => rowLen(s) > 1);
  const fallback = sheets.filter((s) => rowLen(s) > 0);
  return withData[0] ?? fallback[0];
}

/** Validación de alta de columna personalizada; null = ok. */
export function validateNewCustomColumn(
  name: string,
  mapping: string,
  existingNames: string[],
): string | null {
  if (!name.trim()) return "El nombre de la columna es requerido";
  if (!mapping) return "Debe seleccionar una columna del Excel";
  if (existingNames.includes(name.trim().toLowerCase())) {
    return "Ya existe una columna con ese nombre";
  }
  return null;
}

/** Imágenes cuyo nombre matchea el recordId de la fila seleccionada, dedupe por nombre. */
export function filterImagesForRecord(
  images: File[],
  data: Record<string, unknown>[],
  selectedIndex: string,
  idColumn: string,
): File[] {
  if (selectedIndex === "" || !idColumn) return [];
  const idx = Number(selectedIndex);
  if (Number.isNaN(idx) || idx < 0 || idx >= data.length) return [];
  const row = data[idx];
  const recordId = String(row[idColumn] ?? "");
  if (!recordId) return [];

  const seen = new Set<string>();
  return images
    .filter((img) => matchesRecordId(img.name, recordId))
    .filter((img) => {
      if (seen.has(img.name)) return false;
      seen.add(img.name);
      return true;
    })
    .sort(naturalSortFilesByName);
}
