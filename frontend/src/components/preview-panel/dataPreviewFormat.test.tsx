import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import {
  getColumnWidthClass,
  isMonospaceColumn,
  renderStatusBadge,
} from "./dataPreviewFormat";

describe("getColumnWidthClass", () => {
  it.each([
    ["ID", "min-w-[96px]"],
    ["NIS", "min-w-[96px]"],
    ["OT", "min-w-[96px]"],
    ["NRO SUMINISTRO", "min-w-[96px]"],
    ["SECTOR", "min-w-[96px]"],
    ["CUADRILLA", "min-w-[96px]"],
    ["OBSERVACIONES", "min-w-[200px] max-w-[360px]"],
    ["DETALLE", "min-w-[200px] max-w-[360px]"],
    ["DESCRIPCION", "min-w-[200px] max-w-[360px]"],
    ["DIRECCION", "min-w-[180px] max-w-[300px]"],
    ["UBICACION", "min-w-[180px] max-w-[300px]"],
    ["ACTIVIDAD", "min-w-[180px] max-w-[280px]"],
    ["TRABAJO", "min-w-[180px] max-w-[280px]"],
    ["ESTADO", "min-w-[120px]"],
    ["STATUS", "min-w-[120px]"],
    ["CONTRATA", "min-w-[120px]"],
    ["LOCALIDAD", "min-w-[120px]"],
    ["DISTRITO", "min-w-[120px]"],
    ["CENTRO", "min-w-[120px]"],
    ["TIPO RED", "min-w-[120px]"],
    ["FECHA CORTE", "min-w-[104px]"],
    ["DATE", "min-w-[104px]"],
    ["UNA_COLUMNA_MUY_LARGA", "min-w-[150px]"],
    ["MED", "min-w-[110px]"],
  ])("%s → %s", (header, expected) => {
    expect(getColumnWidthClass(header)).toBe(expected);
  });
});

describe("isMonospaceColumn", () => {
  it("solo columnas de identificador", () => {
    for (const h of [
      "ID",
      "NIS",
      "OT",
      "NRO OT",
      "CODIGO",
      "SECTOR",
      "CUADRILLA",
    ]) {
      expect(isMonospaceColumn(h)).toBe(true);
    }
    expect(isMonospaceColumn("DIRECCION")).toBe(false);
  });
});

describe("renderStatusBadge", () => {
  it.each([
    ["ATENDIDO", "accent-green"],
    ["EJECUTADO", "accent-green"],
    ["PENDIENTE", "accent-yellow"],
    ["EN CURSO", "accent-yellow"],
    ["CANCELADO", "accent-red"],
    ["URGENTE", "accent-red"],
    ["OTRO", "bg-elevated"],
  ])("%s → badge %s", (value, cls) => {
    const { container } = render(<>{renderStatusBadge(value)}</>);
    expect(container.innerHTML).toContain(cls);
  });

  it("resalta el query dentro del badge", () => {
    const { container } = render(<>{renderStatusBadge("PENDIENTE", "pend")}</>);
    expect(container.querySelector("mark")).toBeTruthy();
  });
});
