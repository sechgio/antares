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

const loadXlsx = () => import("xlsx");

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
  const XLSX = await loadXlsx();
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, {
    type: "array",
    cellDates: true
  });

  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    throw new Error("El archivo no contiene hojas.");
  }

  const sheet = workbook.Sheets[firstSheetName];
  const matrix = XLSX.utils.sheet_to_json<(string | number | Date)[]>(sheet, {
    header: 1,
    blankrows: false,
    defval: ""
  });

  const headerRow = matrix[0]?.map((value) => String(value).trim()) ?? [];
  const missingColumns = validateColumns(headerRow);

  if (missingColumns.length > 0) {
    throw new Error(
      `Faltan columnas requeridas: ${missingColumns.join(", ")}.`
    );
  }

  const normalizedHeaders = headerRow.map(normalizeHeader);

  const rows = XLSX.utils.sheet_to_json<RawFlyerRecord>(sheet, {
    defval: "",
    raw: true
  });

  const mappedRows = rows.map((row) => {
    const normalized: RawFlyerRecord = {};
    for (const [key, value] of Object.entries(row)) {
      const header = normalizeHeader(key);
      const index = normalizedHeaders.indexOf(header);
      if (index >= 0) {
        normalized[normalizedHeaders[index] as keyof RawFlyerRecord] = value;
      }
    }
    return normalized;
  });

  const warnings: string[] = [];

  const records = mappedRows
    .map((row, index) => mapRowToRecord(row, index, warnings))
    .filter((record): record is FlyerRecord => record !== null);

  if (records.length === 0) {
    throw new Error(
      "No se encontraron filas válidas para generar volantes. " +
      "Verifique que el archivo tenga las columnas: " +
      REQUIRED_COLUMNS.join(", ") + "."
    );
  }

  if (warnings.length > 0) {
    console.warn("[Import] Advertencias:\n" + warnings.join("\n"));
  }

  return { records, warnings };
};

export const exportTemplateWorkbook = async (): Promise<void> => {
  const XLSX = await loadXlsx();
  const worksheet = XLSX.utils.json_to_sheet([
    {
      item: 1,
      sgio: "454654001",
      distrito: "ATE VITARTE",
      fecha: "2026-02-26",
      hora_inicio: "08:00",
      hora_fin: "20:00",
      reservorio: "CR-121 HUASCAR",
      sector: "SECTOR 411",
      zonas_afectadas:
        "AH UPIS Huascar, AH Belen, AH Vista Alegre, AH San Lorenzo"
    }
  ]);

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "volantes");
  XLSX.writeFile(workbook, "plantilla-volantes.xlsx");
};
