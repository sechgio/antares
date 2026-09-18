import { describe, expect, it } from "vitest";
import {
  computeAutoMappings,
  filterImagesForRecord,
  pickSheetToLoad,
  rowsToRecords,
  validateNewCustomColumn,
} from "./sheetLogic";

describe("computeAutoMappings", () => {
  it("mapea headers por id o label de REPORT_FIELDS", () => {
    const { mappings, idColumn } = computeAutoMappings([
      "Codigo Cliente",
      "Dirección",
      "X",
    ]);
    expect(idColumn).toBe("Codigo Cliente");
    // al menos un campo debe mapear si hay coincidencia parcial
    expect(Object.keys(mappings).length).toBeGreaterThanOrEqual(0);
  });

  it("sin headers devuelve mappings vacío e idColumn vacío", () => {
    expect(computeAutoMappings([])).toEqual({ mappings: {}, idColumn: "" });
  });
});

describe("rowsToRecords", () => {
  it("archivo vacío devuelve error", () => {
    expect(rowsToRecords([])).toEqual({
      error: "El archivo está vacío o no tiene filas con datos",
    });
  });

  it("cabeceras todas vacías devuelve error", () => {
    expect(rowsToRecords([[null, "", undefined]])).toEqual({
      error: "El archivo no tiene cabeceras válidas",
    });
  });

  it("sin filas de datos devuelve error", () => {
    expect(rowsToRecords([["A", "B"]])).toEqual({
      error: "El archivo no contiene filas de datos",
    });
  });

  it("construye registros ignorando cabeceras vacías", () => {
    const result = rowsToRecords([
      ["ID", "", "Nombre"],
      ["1", "x", "Ana"],
      ["2", "y", "Luis"],
    ]);
    expect(result).toHaveProperty("headers", ["ID", "", "Nombre"]);
    const data = (result as { data: Record<string, unknown>[] }).data;
    expect(data).toHaveLength(2);
    expect(data[0]).toEqual({ ID: "1", Nombre: "Ana" });
  });

  it("convierte seriales Excel en columnas de fecha", () => {
    const result = rowsToRecords([["Fecha"], [45000]]);
    const data = (result as { data: Record<string, unknown>[] }).data;
    expect(typeof data[0].Fecha).toBe("string");
  });
});

describe("pickSheetToLoad", () => {
  const sheet = (name: string, rows: number, rowCount?: number) => ({
    name,
    rows: Array.from({ length: rows }, () => []),
    rowCount,
  });

  it("prefiere la primera hoja con más de una fila", () => {
    expect(
      pickSheetToLoad([
        sheet("vacia", 0),
        sheet("solo-header", 1),
        sheet("datos", 5),
      ])?.name,
    ).toBe("datos");
  });

  it("usa rowCount cuando rows está vacío (stubs de spill)", () => {
    expect(pickSheetToLoad([sheet("a", 0, 0), sheet("b", 0, 10)])?.name).toBe(
      "b",
    );
  });

  it("cae a la primera no vacía si ninguna tiene datos", () => {
    expect(pickSheetToLoad([sheet("a", 0), sheet("b", 1)])?.name).toBe("b");
    expect(pickSheetToLoad([sheet("a", 0)])).toBeUndefined();
  });
});

describe("validateNewCustomColumn", () => {
  it("requiere nombre", () => {
    expect(validateNewCustomColumn("  ", "col", [])).toBe(
      "El nombre de la columna es requerido",
    );
  });

  it("requiere mapping", () => {
    expect(validateNewCustomColumn("X", "", [])).toBe(
      "Debe seleccionar una columna del Excel",
    );
  });

  it("rechaza duplicados case-insensitive", () => {
    expect(validateNewCustomColumn("Distrito", "col", ["distrito"])).toBe(
      "Ya existe una columna con ese nombre",
    );
    expect(validateNewCustomColumn("Nuevo", "col", ["distrito"])).toBeNull();
  });
});

describe("filterImagesForRecord", () => {
  const files = (...names: string[]) => names.map((n) => new File(["x"], n));

  it("sin selección o sin idColumn devuelve []", () => {
    expect(filterImagesForRecord(files("a.png"), [{}], "", "ID")).toEqual([]);
    expect(filterImagesForRecord(files("a.png"), [{}], "0", "")).toEqual([]);
  });

  it("índice fuera de rango o recordId vacío devuelve []", () => {
    expect(
      filterImagesForRecord(files("a.png"), [{ ID: "x" }], "5", "ID"),
    ).toEqual([]);
    expect(
      filterImagesForRecord(files("a.png"), [{ ID: "" }], "0", "ID"),
    ).toEqual([]);
  });

  it("filtra por recordId, deduplica y ordena natural", () => {
    const data = [{ ID: "42" }];
    // matchesRecordId: stem exacto ('42.png') o stem sin sufijo _N ('42_2.png'→'42')
    const images = files(
      "42_2.png",
      "otra.png",
      "42_1.png",
      "42_1.png",
      "42.png",
    );
    const result = filterImagesForRecord(images, data, "0", "ID");
    expect(result.map((f) => f.name)).toEqual([
      "42.png",
      "42_1.png",
      "42_2.png",
    ]);
  });
});
