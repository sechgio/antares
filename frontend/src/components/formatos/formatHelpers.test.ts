import { beforeEach, describe, expect, it, vi } from "vitest";

const formatosGenerate = vi.fn();
vi.mock("../../api", () => ({
  api: { formatosGenerate: (...a: unknown[]) => formatosGenerate(...a) },
}));

import {
  MAX_PREVIEW_PAGES,
  buildGeneratedPdfName,
  clampZoom,
  fetchPreviewPdf,
  formatCanPreview,
  isPdfFile,
  pad,
} from "./formatHelpers";
import type { FormatInfo } from "../../types";

const fmt = (overrides: Partial<FormatInfo> = {}): FormatInfo =>
  ({ id: "fmt1", strategy: "legacy_xobject", ...overrides }) as FormatInfo;

describe("pad", () => {
  it("rellena con ceros a la izquierda", () => {
    expect(pad(42)).toBe("0000042");
    expect(pad(42, 3)).toBe("042");
    expect(pad(12345678)).toBe("12345678");
  });
});

describe("isPdfFile", () => {
  it("acepta por extensión o MIME", () => {
    expect(isPdfFile(new File(["x"], "a.PDF", { type: "" }))).toBe(true);
    expect(
      isPdfFile(new File(["x"], "a.bin", { type: "application/pdf" })),
    ).toBe(true);
    expect(isPdfFile(new File(["x"], "a.png", { type: "image/png" }))).toBe(
      false,
    );
  });
});

describe("clampZoom", () => {
  it("clampea y redondea", () => {
    expect(clampZoom(10)).toBe(25);
    expect(clampZoom(999)).toBe(300);
    expect(clampZoom(87.6)).toBe(88);
  });
});

describe("buildGeneratedPdfName", () => {
  it("rango simple usa un solo número", () => {
    expect(buildGeneratedPdfName(fmt(), 5, 5)).toBe("fmt1_0000005.pdf");
  });

  it("rango múltiple usa desde-hasta", () => {
    expect(buildGeneratedPdfName(fmt(), 1, 12)).toBe(
      "fmt1_0000001-0000012.pdf",
    );
  });

  it("respeta padding del mapping", () => {
    expect(
      buildGeneratedPdfName(fmt({ mapping: { padding: 3 } as never }), 7, 9),
    ).toBe("fmt1_007-009.pdf");
  });
});

describe("formatCanPreview", () => {
  it("rechaza rangos inválidos", () => {
    expect(formatCanPreview(fmt(), 0, 5)).toBe(false); // desde < numMin
    expect(formatCanPreview(fmt(), 5, 3)).toBe(false); // hasta < desde
    expect(formatCanPreview(fmt({ number_max: 10 }), 1, 20)).toBe(false); // hasta > max
    expect(formatCanPreview(fmt({ max_pages: 3 }), 1, 10)).toBe(false); // total > maxPages
  });

  it("rechaza estrategias sin preview", () => {
    expect(
      formatCanPreview(fmt({ strategy: "otra", has_mapping: false }), 1, 5),
    ).toBe(false);
    expect(
      formatCanPreview(fmt({ strategy: "otra", has_mapping: true }), 1, 5),
    ).toBe(true);
    expect(formatCanPreview(fmt({ strategy: "simple_overlay" }), 1, 5)).toBe(
      true,
    );
  });

  it("acepta rango válido", () => {
    expect(formatCanPreview(fmt(), 1, 10)).toBe(true);
  });
});

describe("fetchPreviewPdf", () => {
  beforeEach(() => vi.clearAllMocks());

  it("limita hasta a MAX_PREVIEW_PAGES y devuelve blob", async () => {
    formatosGenerate.mockResolvedValue({ pdf_base64: btoa("PDFBYTES") });
    const res = await fetchPreviewPdf("f1", 1, 100);
    expect(formatosGenerate).toHaveBeenCalledWith({
      format_id: "f1",
      desde: 1,
      hasta: 1 + MAX_PREVIEW_PAGES - 1,
    });
    expect(res.previewTotal).toBe(100);
    expect(res.previewDesde).toBe(1);
    expect(res.blob.type).toBe("application/pdf");
  });

  it("falla si no llega pdf_base64", async () => {
    formatosGenerate.mockResolvedValue({ pdf_base64: "" });
    await expect(fetchPreviewPdf("f1", 1, 2)).rejects.toThrow("vista previa");
  });
});
