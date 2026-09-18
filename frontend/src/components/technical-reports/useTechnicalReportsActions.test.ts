import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const addToast = vi.fn();
const fileToDataUrl = vi.fn();
const downloadBase64Pdf = vi.fn();
const saveFeatureHistory = vi.fn().mockResolvedValue(undefined);
const renderHtml = vi.fn();
const htmlToPdf = vi.fn();
const renderConsolidatedHtml = vi.fn();

vi.mock("../../hooks/useToast", () => ({ useToast: () => ({ addToast }) }));
vi.mock("../../utils/pdfAssets", () => ({
  fileToDataUrl: (...a: unknown[]) => fileToDataUrl(...a),
  downloadBase64Pdf: (...a: unknown[]) => downloadBase64Pdf(...a),
}));
vi.mock("../../utils/history", () => ({
  saveFeatureHistory: (...a: unknown[]) => saveFeatureHistory(...a),
}));
vi.mock("./api", () => ({
  technicalReportsApi: {
    renderHtml: (...a: unknown[]) => renderHtml(...a),
    htmlToPdf: (...a: unknown[]) => htmlToPdf(...a),
    renderConsolidatedHtml: (...a: unknown[]) => renderConsolidatedHtml(...a),
  },
}));

import { useTechnicalReportsActions } from "./useTechnicalReportsActions";

function makeWorkspace(overrides: Record<string, unknown> = {}) {
  return {
    reports: [],
    formData: { id: "r1", titulo: "Inf" } as { id: string } | null,
    hasChanges: false,
    runOperation: async (op: () => Promise<void>) => op(),
    saveCurrent: vi.fn(),
    ...overrides,
  };
}

describe("useTechnicalReportsActions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("changeLogo limpia el lado sin file y carga dataUrl con file", async () => {
    const { result } = renderHook(() =>
      useTechnicalReportsActions(makeWorkspace()),
    );
    fileToDataUrl.mockResolvedValue("data:image/png;base64,logo");
    await act(async () => {
      await result.current.changeLogo("left", new File(["x"], "l.png"));
    });
    expect(result.current.logoLeft).toBe("data:image/png;base64,logo");
    await act(async () => {
      await result.current.changeLogo("left", null);
    });
    expect(result.current.logoLeft).toBeNull();
    await act(async () => {
      await result.current.changeLogo("right", new File(["x"], "r.png"));
    });
    expect(result.current.logoRight).toBe("data:image/png;base64,logo");
  });

  it("changeLogo con error de lectura produce toast de error", async () => {
    const { result } = renderHook(() =>
      useTechnicalReportsActions(makeWorkspace()),
    );
    fileToDataUrl.mockRejectedValue(new Error("boom"));
    await act(async () => {
      await result.current.changeLogo("left", new File(["x"], "l.png"));
    });
    expect(addToast).toHaveBeenCalledWith(
      expect.objectContaining({ message: "boom", type: "error" }),
    );
  });

  it("exportCurrent sin formData no hace nada", async () => {
    const { result } = renderHook(() =>
      useTechnicalReportsActions(makeWorkspace({ formData: null })),
    );
    await act(async () => {
      await result.current.exportCurrent();
    });
    expect(renderHtml).not.toHaveBeenCalled();
  });

  it("exportCurrent renderiza, convierte, descarga y guarda historial", async () => {
    renderHtml.mockResolvedValue({ html: "<p>x</p>", filename: "inf.html" });
    htmlToPdf.mockResolvedValue({ pdf_base64: "UFBE", filename: "inf.pdf" });
    const { result } = renderHook(() =>
      useTechnicalReportsActions(makeWorkspace()),
    );
    await act(async () => {
      await result.current.exportCurrent();
    });
    expect(renderHtml).toHaveBeenCalledWith(
      expect.objectContaining({ id: "r1" }),
    );
    expect(downloadBase64Pdf).toHaveBeenCalledWith("UFBE", "inf.pdf");
    expect(saveFeatureHistory).toHaveBeenCalledWith(
      "informe_tecnico",
      "inf.pdf",
      { type: "individual", reportId: "r1" },
    );
    expect(addToast).toHaveBeenCalledWith(
      expect.objectContaining({ type: "success" }),
    );
  });

  it("exportCurrent con cambios guarda antes de renderizar", async () => {
    const saveCurrent = vi.fn().mockResolvedValue({ id: "r1-saved" });
    renderHtml.mockResolvedValue({ html: "<p>x</p>", filename: "inf.html" });
    htmlToPdf.mockResolvedValue({ pdf_base64: "UFBE", filename: "inf.pdf" });
    const { result } = renderHook(() =>
      useTechnicalReportsActions(
        makeWorkspace({ hasChanges: true, saveCurrent }),
      ),
    );
    await act(async () => {
      await result.current.exportCurrent();
    });
    expect(saveCurrent).toHaveBeenCalled();
    expect(renderHtml).toHaveBeenCalledWith(
      expect.objectContaining({ id: "r1-saved" }),
    );
  });

  it("exportCurrent falla si pdf_base64 vacío", async () => {
    renderHtml.mockResolvedValue({ html: "<p>x</p>", filename: "inf.html" });
    htmlToPdf.mockResolvedValue({ pdf_base64: "", filename: "inf.pdf" });
    const { result } = renderHook(() =>
      useTechnicalReportsActions(makeWorkspace()),
    );
    await act(async () => {
      await result.current.exportCurrent();
    });
    expect(addToast).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "No se recibio el contenido del PDF generado.",
        type: "error",
      }),
    );
  });

  it("exportConsolidated sin informes no hace nada", async () => {
    const { result } = renderHook(() =>
      useTechnicalReportsActions(makeWorkspace()),
    );
    await act(async () => {
      await result.current.exportConsolidated();
    });
    expect(renderConsolidatedHtml).not.toHaveBeenCalled();
  });

  it("exportConsolidated genera PDF consolidado e historial con count", async () => {
    renderConsolidatedHtml.mockResolvedValue({
      html: "<p>c</p>",
      filename: "con.html",
      count: 3,
    });
    htmlToPdf.mockResolvedValue({ pdf_base64: "UFBE", filename: "con.pdf" });
    const { result } = renderHook(() =>
      useTechnicalReportsActions(
        makeWorkspace({ reports: [{ id: "a" }, { id: "b" }, { id: "c" }] }),
      ),
    );
    await act(async () => {
      await result.current.exportConsolidated();
    });
    expect(saveFeatureHistory).toHaveBeenCalledWith(
      "informe_tecnico",
      "con.pdf",
      { type: "consolidado", count: 3 },
      3,
    );
    expect(addToast).toHaveBeenCalledWith(
      expect.objectContaining({ message: "PDF consolidado generado (3)" }),
    );
  });
});
