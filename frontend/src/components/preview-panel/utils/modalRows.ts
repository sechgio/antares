import { normalizeRecordId } from "../../../utils/recordMatching";

export type SortDirection = "asc" | "desc";
export type FilterPhotoType = "all" | "with-photos" | "without-photos";

export interface PhotoInfo {
  count: number;
  files: File[];
}

export interface RowItem {
  row: Record<string, unknown>;
  originalIndex: number;
  photoInfo: PhotoInfo;
}

/** Mapa fila → fotos matcheadas por el id normalizado de su columna clave. */
export function buildRowPhotoMap(
  data: Record<string, unknown>[],
  idColumn: string,
  imagesByRecordId: Map<string, File[]>,
): Map<number, PhotoInfo> {
  const map = new Map<number, PhotoInfo>();
  data.forEach((row, idx) => {
    const normalized = normalizeRecordId(String(row[idColumn] ?? "").trim());
    if (!normalized) {
      map.set(idx, { count: 0, files: [] });
      return;
    }
    const files = imagesByRecordId.get(normalized) ?? [];
    map.set(idx, { count: files.length, files });
  });
  return map;
}

export function computePhotoStats(
  data: Record<string, unknown>[],
  rowPhotoMap: Map<number, PhotoInfo>,
): { total: number; withPhotos: number; withoutPhotos: number } {
  let withPhotos = 0;
  data.forEach((_, idx) => {
    if ((rowPhotoMap.get(idx)?.count ?? 0) > 0) withPhotos++;
  });
  return {
    total: data.length,
    withPhotos,
    withoutPhotos: data.length - withPhotos,
  };
}

/** Filtra por fotos y texto, y ordena por #, fotos o columna (numérica si aplica). */
export function filterAndSortRows(params: {
  data: Record<string, unknown>[];
  headers: string[];
  rowPhotoMap: Map<number, PhotoInfo>;
  query: string;
  photoFilter: FilterPhotoType;
  sortCol: string | null;
  sortDir: SortDirection;
}): RowItem[] {
  const { data, headers, rowPhotoMap, photoFilter, sortCol, sortDir } = params;
  const query = params.query.trim().toLowerCase();

  let items = data.map((row, originalIndex) => ({
    row,
    originalIndex,
    photoInfo: rowPhotoMap.get(originalIndex) ?? { count: 0, files: [] },
  }));

  if (photoFilter === "with-photos") {
    items = items.filter((item) => item.photoInfo.count > 0);
  } else if (photoFilter === "without-photos") {
    items = items.filter((item) => item.photoInfo.count === 0);
  }

  if (query) {
    items = items.filter(({ row }) =>
      headers.some((h) =>
        String(row[h] ?? "")
          .toLowerCase()
          .includes(query),
      ),
    );
  }

  if (sortCol) {
    items.sort((a, b) => {
      if (sortCol === "#") {
        return sortDir === "asc"
          ? a.originalIndex - b.originalIndex
          : b.originalIndex - a.originalIndex;
      }
      if (sortCol === "__fotos__") {
        return sortDir === "asc"
          ? a.photoInfo.count - b.photoInfo.count
          : b.photoInfo.count - a.photoInfo.count;
      }
      const valA = String(a.row[sortCol] ?? "").trim();
      const valB = String(b.row[sortCol] ?? "").trim();

      const numA = Number(valA);
      const numB = Number(valB);
      if (!isNaN(numA) && !isNaN(numB) && valA !== "" && valB !== "") {
        return sortDir === "asc" ? numA - numB : numB - numA;
      }

      return sortDir === "asc"
        ? valA.localeCompare(valB, "es", { numeric: true, sensitivity: "base" })
        : valB.localeCompare(valA, "es", {
            numeric: true,
            sensitivity: "base",
          });
    });
  }

  return items;
}

/** Ciclo de click en cabecera: asc → desc → sin orden. */
export function cycleSort(
  currentCol: string | null,
  currentDir: SortDirection,
  clicked: string,
): { sortCol: string | null; sortDir: SortDirection } {
  if (currentCol === clicked) {
    if (currentDir === "asc") return { sortCol: clicked, sortDir: "desc" };
    return { sortCol: null, sortDir: "asc" };
  }
  return { sortCol: clicked, sortDir: "asc" };
}

/** Toggle de visibilidad de columna; no permite ocultar la última visible. */
export function toggleHiddenColumn(
  hidden: Set<string>,
  header: string,
  totalHeaders: number,
): Set<string> {
  const next = new Set(hidden);
  if (next.has(header)) next.delete(header);
  else if (totalHeaders - next.size > 1) next.add(header);
  return next;
}

/** CSV con BOM y quoting; filas = filas filtradas + '#' + 'Fotos'. */
export function buildCsvContent(
  visibleHeaders: string[],
  items: RowItem[],
): string {
  const csvHeaders = ["#", ...visibleHeaders, "Fotos"];
  const csvRows = items.map(({ row, originalIndex, photoInfo }) => {
    const values = [
      String(originalIndex + 1),
      ...visibleHeaders.map(
        (h) => `"${String(row[h] ?? "").replace(/"/g, '""')}"`,
      ),
      String(photoInfo.count),
    ];
    return values.join(",");
  });
  return "﻿" + [csvHeaders.join(","), ...csvRows].join("\r\n");
}
