import { describe, expect, it } from "vitest";
import {
  filterItemsInRange,
  folioLabelTotal,
  isLuriganchoFormat,
  isWaterCutFormat,
  previewWindow,
  resizeItemsPreserve,
  resolvePreviewVariant,
  resolveRowsPerPage,
} from "./previewMath";
import type { PadronItem } from "./data";

const item = (n: number, extra = ""): PadronItem =>
  ({
    item: n,
    nombresApellidos: `N${n}${extra}`,
    direccion: "",
    horaComunicacion: "",
  }) as PadronItem;

describe("filterItemsInRange", () => {
  const items = [item(3), item(1), item(5), item(2)];

  it("filtra por rango y ordena por número", () => {
    expect(filterItemsInRange(items, 2, 4, 10).map((i) => i.item)).toEqual([
      2, 3,
    ]);
  });

  it("clampea start a [1, max] y end a [start, max]", () => {
    expect(filterItemsInRange(items, -5, 100, 5).map((i) => i.item)).toEqual([
      1, 2, 3, 5,
    ]);
    // start clampea a max y end a [start, max]: rango degenera a {5}
    expect(filterItemsInRange(items, 9, 2, 5).map((i) => i.item)).toEqual([5]);
  });
});

describe("resizeItemsPreserve", () => {
  const factory = (total: number) =>
    Array.from({ length: total }, (_, i) => item(i + 1, "-nuevo"));

  it("crece preservando los items existentes", () => {
    const result = resizeItemsPreserve([item(1, "-editado")], 3, factory);
    expect(result).toHaveLength(3);
    expect(result[0].nombresApellidos).toBe("N1-editado");
    expect(result[2].nombresApellidos).toBe("N3-nuevo");
  });

  it("reduce descartando los items fuera del nuevo total", () => {
    const result = resizeItemsPreserve(
      [item(1, "-e"), item(2, "-e"), item(3, "-e")],
      2,
      factory,
    );
    expect(result).toHaveLength(2);
    expect(result[1].nombresApellidos).toBe("N2-e");
  });
});

describe("formatos", () => {
  it("isWaterCutFormat e isLuriganchoFormat discriminan", () => {
    expect(isWaterCutFormat("water-cut-notice")).toBe(true);
    expect(isWaterCutFormat("service-interruption")).toBe(false);
    expect(isLuriganchoFormat("volante-lurigancho")).toBe(true);
    expect(isLuriganchoFormat("volanteo-lurigancho-v2")).toBe(true);
    expect(isLuriganchoFormat("water-cut-notice")).toBe(false);
  });

  it("resolvePreviewVariant mantiene lurigancho y cae a service-interruption", () => {
    expect(resolvePreviewVariant("volante-lurigancho")).toBe(
      "volante-lurigancho",
    );
    expect(resolvePreviewVariant("water-cut-notice")).toBe(
      "service-interruption",
    );
  });

  it("resolveRowsPerPage: 39 fijo en water-cut, 18/37 según orientación", () => {
    expect(resolveRowsPerPage("water-cut-notice", "portrait")).toBe(39);
    expect(resolveRowsPerPage("service-interruption", "landscape")).toBe(18);
    expect(resolveRowsPerPage("service-interruption", "portrait")).toBe(37);
  });
});

describe("previewWindow", () => {
  it("devuelve desde offset hasta +maxPages", () => {
    expect(previewWindow(0, 10)).toEqual({ start: 0, end: 5 });
    expect(previewWindow(7, 10)).toEqual({ start: 5, end: 10 });
  });

  it("nunca excede el total y no retrocede por offset alto", () => {
    expect(previewWindow(20, 3)).toEqual({ start: 0, end: 3 });
  });
});

describe("folioLabelTotal", () => {
  it("usa el folio físico máximo o el count de páginas", () => {
    expect(folioLabelTotal([1, 5, 3], 4)).toBe(5);
    expect(folioLabelTotal([], 7)).toBe(7);
  });
});
