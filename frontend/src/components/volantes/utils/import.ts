import { downloadBase64Blob } from "../../../utils/pdfAssets";
import { REQUIRED_COLUMNS } from "../constants";
import type {
  FlyerRecord,
  ImportResult,
  RawFlyerRecord
} from "../types";
import {
  normalizeDateInput,
  normalizeHeader,
  normalizeTimeInput,
  sanitizeMultilineText,
  toSlugId
} from "./format";

const IMPORT_PAGE_SIZE = 2000;

const validateColumns = (headers: string[]): string[] => {
  const normalized = headers.map(normalizeHeader);
  return REQUIRED_COLUMNS.filter((column) => !normalized.includes(column));
};

const mapRowToRecord = (
  row: RawFlyerRecord,
  rowIndex: number,
  warnings: string[]
): FlyerRecord | null => {
  const rowLabel = `Fila ${rowIndex + 2}`;

  const distrito = String(row.distrito ?? "").trim();
  const reservorio = String(row.reservorio ?? "").trim();
  const sector = String(row.sector ?? "").trim();
  const zonasAfectadas = sanitizeMultilineText(
    String(row.zonas_afectadas ?? "").trim()
  );
  const fecha = normalizeDateInput(row.fecha);
  const horaInicio = normalizeTimeInput(row.hora_inicio);
  const horaFin = normalizeTimeInput(row.hora_fin);

  const allEmpty =
    !distrito &&
    !reservorio &&
    !sector &&
    !zonasAfectadas &&
    !fecha &&
    !horaInicio &&
    !horaFin;
  if (allEmpty) {
    return null;
  }

  if (!distrito || !reservorio) {
    warnings.push(`${rowLabel}: falta distrito o reservorio.`);
    return null;
  }

  if (!fecha) {
    warnings.push(`${rowLabel}: fecha inválida o vacía.`);
    return null;
  }

  if (!horaInicio || !horaFin) {
    warnings.push(`${rowLabel}: hora_inicio u hora_fin inválida.`);
    return null;
  }

  return {
    id: toSlugId(),
    distrito: distrito.toUpperCase(),
    fecha,
    horaInicio,
    horaFin,
    reservorio: reservorio.toUpperCase(),
    sector,
    zonasAfectadas
  };
};

const appendRecordsFromRows = (
  rows: unknown[][],
  normalizedHeaders: string[],
  startIndex: number,
  warnings: string[],
  records: FlyerRecord[],
  skipHeader = false,
): number => {
  const firstRow = skipHeader ? 1 : 0;
  for (let rowOffset = firstRow; rowOffset < rows.length; rowOffset += 1) {
    const normalized: RawFlyerRecord = {};
    (rows[rowOffset] ?? []).forEach((value, columnIndex) => {
      const header = normalizedHeaders[columnIndex];
      if (header) (normalized as Record<string, unknown>)[header] = value;
    });
    const record = mapRowToRecord(
      normalized,
      startIndex + rowOffset - firstRow,
      warnings,
    );
    if (record) records.push(record);
  }
  return Math.max(0, rows.length - firstRow);
};

export const importSpreadsheet = async (file: File): Promise<ImportResult> => {
  const { api } = await import("../../../api");
  const { stageFileForIpc } = await import("../../../utils/stageFile");
  const ext = file.name.toLowerCase().split('.').pop() || '';
  const formatHint = ['xlsx','xls','csv'].includes(ext) ? ext : undefined;
  const fileToken = await stageFileForIpc(file);
  const res = await api.spreadsheetParse(
    { file_token: fileToken, format_hint: formatHint },
    { hydrate: false },
  );
  const warnings: string[] = [...(res.warnings||[])];
  const records: FlyerRecord[] = [];
  const resultToken = res.result_file_token;

  try {
    let firstRows: unknown[][];
    let nextOffset = 0;
    let hasMore = false;

    if (resultToken) {
      const firstPage = await api.spreadsheetGetRows({
        result_file_token: resultToken,
        sheet_index: 0,
        offset: 0,
        limit: IMPORT_PAGE_SIZE,
      });
      firstRows = firstPage.rows;
      nextOffset = firstPage.rows.length;
      hasMore = firstPage.has_more;
    } else {
      firstRows = res.sheets[0]?.rows ?? [];
    }

    if (!firstRows.length) throw new Error("El archivo no contiene hojas.");
    const headerRow = (firstRows[0] as unknown[]).map((value) => String(value ?? "").trim());
    const missingColumns = validateColumns(headerRow);
    if (missingColumns.length > 0) {
      throw new Error(`Faltan columnas requeridas: ${missingColumns.join(", ")}.`);
    }
    const normalizedHeaders = headerRow.map(normalizeHeader);

    let dataRowIndex = appendRecordsFromRows(
      firstRows,
      normalizedHeaders,
      0,
      warnings,
      records,
      true,
    );

    while (resultToken && hasMore) {
      const page = await api.spreadsheetGetRows({
        result_file_token: resultToken,
        sheet_index: 0,
        offset: nextOffset,
        limit: IMPORT_PAGE_SIZE,
      });
      if (page.rows.length === 0) break;
      dataRowIndex += appendRecordsFromRows(
        page.rows,
        normalizedHeaders,
        dataRowIndex,
        warnings,
        records,
      );
      nextOffset += page.rows.length;
      hasMore = page.has_more;
    }
  } finally {
    if (resultToken) {
      try {
        await api.fileTokenCleanup(resultToken);
      } catch (error) {
        console.warn("[Import] No se pudo liberar el resultado temporal:", error);
      }
    }
  }

  if (records.length === 0) {
    throw new Error("No se encontraron filas válidas para generar volantes. Verifique que el archivo tenga las columnas: " + REQUIRED_COLUMNS.join(", ") + ".");
  }
  if (warnings.length > 0) console.warn("[Import] Advertencias:\n" + warnings.join("\n"));
  return { records, warnings };
};

export const exportTemplateWorkbook = async (): Promise<void> => {
  const { api } = await import("../../../api");
  const res = await api.spreadsheetExportVolantesTemplate();
  downloadBase64Blob(
    res.content_b64,
    res.filename || "plantilla-volantes.xlsx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
};
