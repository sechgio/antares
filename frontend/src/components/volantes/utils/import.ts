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

export const importSpreadsheet = async (file: File): Promise<ImportResult> => {
  const { api } = await import("../../../api");
  const { stageFileForIpc } = await import("../../../utils/stageFile");
  const ext = file.name.toLowerCase().split('.').pop() || '';
  const formatHint = ['xlsx','xls','csv'].includes(ext) ? ext : undefined;
  const fileToken = await stageFileForIpc(file);
  const res = await api.spreadsheetParse({ file_token: fileToken, format_hint: formatHint });
  const sheet = res.sheets[0];
  if (!sheet || !sheet.rows.length) throw new Error("El archivo no contiene hojas.");
  const headerRow = (sheet.rows[0] as unknown[]).map((v)=> String(v ?? "").trim());
  const missingColumns = validateColumns(headerRow);
  if (missingColumns.length > 0) throw new Error(`Faltan columnas requeridas: ${missingColumns.join(", ")}.`);
  const normalizedHeaders = headerRow.map(normalizeHeader);
  const dataRows = sheet.rows.slice(1) as unknown[][];
  const mappedRows = dataRows.map((rowArr) => {
    const normalized: RawFlyerRecord = {};
    rowArr.forEach((val, idx) => {
      const h = normalizedHeaders[idx];
      if (h) (normalized as Record<string,unknown>)[h] = val;
    });
    return normalized;
  });
  const warnings: string[] = [...(res.warnings||[])];
  const records = mappedRows.map((row, index) => mapRowToRecord(row, index, warnings)).filter((r): r is FlyerRecord => r !== null);
  if (records.length === 0) throw new Error("No se encontraron filas válidas para generar volantes. Verifique que el archivo tenga las columnas: " + REQUIRED_COLUMNS.join(", ") + ".");
  if (warnings.length > 0) console.warn("[Import] Advertencias:\n" + warnings.join("\n"));
  return { records, warnings };
};

export const exportTemplateWorkbook = async (): Promise<void> => {
  const { api } = await import("../../../api");
  const res = await (api as unknown as { spreadsheetExportVolantesTemplate:()=>Promise<{content_b64:string,filename:string}> }).spreadsheetExportVolantesTemplate();
  const bytes = Uint8Array.from(atob(res.content_b64), c=>c.charCodeAt(0));
  const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href=url; a.download=res.filename||"plantilla-volantes.xlsx"; a.click(); setTimeout(()=>URL.revokeObjectURL(url), 2000);
};
