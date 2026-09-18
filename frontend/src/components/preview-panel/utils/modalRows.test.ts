import { describe, expect, it } from "vitest";
import {
  buildCsvContent,
  buildRowPhotoMap,
  computePhotoStats,
  cycleSort,
  filterAndSortRows,
  toggleHiddenColumn,
} from "./modalRows";

const file = (n: string) => new File(["x"], n);

const data = [
  { ID: "1", Nombre: "Ana" },
  { ID: "2", Nombre: "Luis" },
  { ID: "3", Nombre: "Carlos" },
];

const imgMap = new Map([
  ["1", [file("1.png"), file("1_2.png")]],
  ["3", [file("3.png")]],
]);
const photoMap = buildRowPhotoMap(data, "ID", imgMap);

describe("buildRowPhotoMap / computePhotoStats", () => {
  it("cuenta fotos por fila vía id normalizado", () => {
    expect(photoMap.get(0)?.count).toBe(2);
    expect(photoMap.get(1)?.count).toBe(0);
    expect(photoMap.get(2)?.count).toBe(1);
  });

  it("id vacío da 0 fotos", () => {
    const m = buildRowPhotoMap([{ ID: "" }, { Otro: "x" }], "ID", imgMap);
    expect(m.get(0)?.count).toBe(0);
    expect(m.get(1)?.count).toBe(0);
  });

  it("stats suman total/con/sin fotos", () => {
    expect(computePhotoStats(data, photoMap)).toEqual({
      total: 3,
      withPhotos: 2,
      withoutPhotos: 1,
    });
  });
});

describe("filterAndSortRows", () => {
  const base = {
    data,
    headers: ["ID", "Nombre"],
    rowPhotoMap: photoMap,
    query: "",
    photoFilter: "all" as const,
    sortCol: null,
    sortDir: "asc" as const,
  };

  it("sin filtros devuelve todo con photoInfo adjunta", () => {
    const items = filterAndSortRows(base);
    expect(items).toHaveLength(3);
    expect(items[0].photoInfo.count).toBe(2);
  });

  it("photoFilter filtra con/sin fotos", () => {
    expect(
      filterAndSortRows({ ...base, photoFilter: "with-photos" }),
    ).toHaveLength(2);
    expect(
      filterAndSortRows({ ...base, photoFilter: "without-photos" }),
    ).toHaveLength(1);
  });

  it("query busca en cualquier cabecera, case-insensitive", () => {
    expect(
      filterAndSortRows({ ...base, query: "ana" }).map((i) => i.originalIndex),
    ).toEqual([0]);
    expect(
      filterAndSortRows({ ...base, query: "  LUIS  " }).map(
        (i) => i.originalIndex,
      ),
    ).toEqual([1]);
  });

  it("ordena por # según índice original", () => {
    const items = filterAndSortRows({ ...base, sortCol: "#", sortDir: "desc" });
    expect(items.map((i) => i.originalIndex)).toEqual([2, 1, 0]);
  });

  it("ordena por __fotos__ según count", () => {
    const items = filterAndSortRows({
      ...base,
      sortCol: "__fotos__",
      sortDir: "asc",
    });
    expect(items.map((i) => i.photoInfo.count)).toEqual([0, 1, 2]);
  });

  it("ordena numéricamente columnas de números", () => {
    const d = [{ ID: "10" }, { ID: "9" }, { ID: "100" }];
    const m = buildRowPhotoMap(d, "ID", new Map());
    const items = filterAndSortRows({
      data: d,
      headers: ["ID"],
      rowPhotoMap: m,
      query: "",
      photoFilter: "all",
      sortCol: "ID",
      sortDir: "asc",
    });
    expect(items.map((i) => i.row.ID)).toEqual(["9", "10", "100"]);
  });

  it("ordena alfabéticamente columnas de texto con locale es", () => {
    const items = filterAndSortRows({
      ...base,
      sortCol: "Nombre",
      sortDir: "asc",
    });
    expect(items.map((i) => i.row.Nombre)).toEqual(["Ana", "Carlos", "Luis"]);
  });
});

describe("cycleSort", () => {
  it("asc → desc → sin orden en el mismo col; reset al cambiar", () => {
    expect(cycleSort(null, "asc", "ID")).toEqual({
      sortCol: "ID",
      sortDir: "asc",
    });
    expect(cycleSort("ID", "asc", "ID")).toEqual({
      sortCol: "ID",
      sortDir: "desc",
    });
    expect(cycleSort("ID", "desc", "ID")).toEqual({
      sortCol: null,
      sortDir: "asc",
    });
    expect(cycleSort("ID", "desc", "Nombre")).toEqual({
      sortCol: "Nombre",
      sortDir: "asc",
    });
  });
});

describe("toggleHiddenColumn", () => {
  it("alterna visibilidad sin permitir ocultar la última", () => {
    const hidden = new Set<string>();
    const h1 = toggleHiddenColumn(hidden, "a", 3);
    expect(h1.has("a")).toBe(true);
    const h2 = toggleHiddenColumn(h1, "b", 3);
    expect(h2.has("b")).toBe(true);
    // quedaría 0 visibles → no aplica
    const h3 = toggleHiddenColumn(h2, "c", 3);
    expect(h3.has("c")).toBe(false);
    // des-ocultar siempre funciona
    expect(toggleHiddenColumn(h2, "a", 3).has("a")).toBe(false);
  });
});

describe("buildCsvContent", () => {
  it("genera BOM, cabeceras y escapa comillas", () => {
    const items = filterAndSortRows({
      data: [{ ID: "1", Nombre: 'An "comillas" ana' }],
      headers: ["ID", "Nombre"],
      rowPhotoMap: buildRowPhotoMap([{ ID: "1" }], "ID", imgMap),
      query: "",
      photoFilter: "all",
      sortCol: null,
      sortDir: "asc",
    });
    const csv = buildCsvContent(["ID", "Nombre"], items);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("﻿#,ID,Nombre,Fotos");
    expect(lines[1]).toBe('1,"1","An ""comillas"" ana",2');
  });
});
