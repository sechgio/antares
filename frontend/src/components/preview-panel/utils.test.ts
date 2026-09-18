import { describe, expect, it } from "vitest";
import {
  chunkItems,
  escapeHtml,
  formatDateValue,
  isDateColumn,
  normalizePreviewValue,
  validateTemplateStructure,
} from "./utils";

describe("formatDateValue", () => {
  it('vacío o "-" devuelve "-"', () => {
    expect(formatDateValue(undefined)).toBe("-");
    expect(formatDateValue("-")).toBe("-");
    expect(formatDateValue("   ")).toBe("-");
  });

  it("formatos dd/mm/yyyy e ISO pasan tal cual", () => {
    expect(formatDateValue("15/03/2024")).toBe("15/03/2024");
    expect(formatDateValue("2024-03-15")).toBe("2024-03-15");
    expect(formatDateValue("5-3-24")).toBe("5-3-24");
  });

  it("otras fechas parseables van a es-ES", () => {
    expect(formatDateValue("March 15, 2024")).toBe("15/3/2024");
  });

  it("texto no fecha se devuelve tal cual", () => {
    expect(formatDateValue("no-fecha")).toBe("no-fecha");
  });
});

describe("isDateColumn", () => {
  it("detecta fecha/date/corte/trabajo", () => {
    for (const h of ["FECHA CORTE", "Date", "fecha_trabajo", "Día trabajo"]) {
      expect(isDateColumn(h)).toBe(true);
    }
    expect(isDateColumn("nombre")).toBe(false);
  });
});

describe("escapeHtml", () => {
  it("escapa &, <, >, comillas y null/undefined", () => {
    expect(escapeHtml(`a<b>&"'"`)).toBe("a&lt;b&gt;&amp;&quot;&#39;&quot;");
    expect(escapeHtml(null)).toBe("");
    expect(escapeHtml(undefined)).toBe("");
    expect(escapeHtml(42)).toBe("42");
  });
});

describe("normalizePreviewValue", () => {
  it("null/vacío cae al fallback, texto trim", () => {
    expect(normalizePreviewValue(null)).toBe("-");
    expect(normalizePreviewValue("  ")).toBe("-");
    expect(normalizePreviewValue("  x ", "?")).toBe("x");
    expect(normalizePreviewValue(0)).toBe("0");
  });
});

describe("chunkItems", () => {
  it("trocea en grupos de N", () => {
    expect(chunkItems([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunkItems([], 4)).toEqual([]);
  });
});

describe("validateTemplateStructure", () => {
  it("requiere variables jinja conocidas", () => {
    expect(validateTemplateStructure("<html></html>").valid).toBe(false);
    expect(validateTemplateStructure("<html>{{ data }}</html>").valid).toBe(
      true,
    );
    expect(validateTemplateStructure("<html>report.images</html>").valid).toBe(
      true,
    );
  });

  it("requiere documento HTML", () => {
    const res = validateTemplateStructure("{{ data }} sin html");
    expect(res.valid).toBe(false);
    expect(res.error).toContain("HTML");
  });
});
