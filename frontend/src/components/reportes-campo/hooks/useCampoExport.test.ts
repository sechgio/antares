import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const addToast = vi.fn();
const exportReportPdf = vi.fn();
const exportConsolidatedReportPdf = vi.fn();
const saveFeatureHistory = vi.fn().mockResolvedValue(undefined);

vi.mock("../../../hooks/useToast", () => ({ useToast: () => ({ addToast }) }));
vi.mock("../../../utils/history", () => ({
  saveFeatureHistory: (...a: unknown[]) => saveFeatureHistory(...a),
}));
vi.mock("../utils/export", () => ({
  buildIndividualFilename: () => "panel_x.pdf",
  exportReportPdf: (...a: unknown[]) => exportReportPdf(...a),
  exportConsolidatedReportPdf: (...a: unknown[]) =>
    exportConsolidatedReportPdf(...a),
}));

import { useCampoExport } from "./useCampoExport";
import type { CampoPanel, PhotoFile, ReportTypeConfig } from "../types";

const config = {
  id: "panel-fotografico",
  label: "Panel",
  filename: "panel.pdf",
} as ReportTypeConfig;
const photo = { name: "p1" } as PhotoFile;
const panel = {
  id: "p1",
  label: "P1",
  header: {},
  photos: [photo],
} as CampoPanel;

function makeParams(overrides: Record<string, unknown> = {}) {
  return {
    config,
    panels: [panel],
    selectedPanel: panel,
    photos: [photo],
    header: {},
    logoLeft: null,
    logoRight: null,
    exportablePanelCount: 1,
    ...overrides,
  };
}

describe("useCampoExport", () => {
  beforeEach(() => vi.clearAllMocks());

  it("exportCurrent sin fotos avisa y no exporta", async () => {
    const { result } = renderHook(() =>
      useCampoExport(makeParams({ photos: [], selectedPanel: null })),
    );
    await act(async () => {
      await result.current.handleExportCurrent();
    });
    expect(exportReportPdf).not.toHaveBeenCalled();
    expect(addToast).toHaveBeenCalledWith(
      expect.objectContaining({ type: "error" }),
    );
  });

  it("exportCurrent cancelado no guarda historial ni toast", async () => {
    exportReportPdf.mockResolvedValue({ cancelled: true });
    const { result } = renderHook(() => useCampoExport(makeParams()));
    await act(async () => {
      await result.current.handleExportCurrent();
    });
    expect(saveFeatureHistory).not.toHaveBeenCalled();
    expect(addToast).not.toHaveBeenCalled();
  });

  it("exportCurrent guarda historial con label del panel", async () => {
    exportReportPdf.mockResolvedValue({
      cancelled: false,
      filename: "panel_x.pdf",
    });
    const { result } = renderHook(() => useCampoExport(makeParams()));
    await act(async () => {
      await result.current.handleExportCurrent();
    });
    expect(saveFeatureHistory).toHaveBeenCalledWith(
      "reporte_campo",
      "Panel - P1",
      expect.objectContaining({ type: "individual", photos: 1 }),
      1,
    );
    expect(addToast).toHaveBeenCalledWith(
      expect.objectContaining({ type: "success" }),
    );
  });

  it("exportCurrent propaga error como toast", async () => {
    exportReportPdf.mockRejectedValue(new Error("fallo pdf"));
    const { result } = renderHook(() => useCampoExport(makeParams()));
    await act(async () => {
      await result.current.handleExportCurrent();
    });
    expect(addToast).toHaveBeenCalledWith(
      expect.objectContaining({ message: "fallo pdf", type: "error" }),
    );
    expect(result.current.isExporting).toBe(false);
  });

  it("exportConsolidated sin paneles exportables avisa y no exporta", async () => {
    const { result } = renderHook(() =>
      useCampoExport(makeParams({ exportablePanelCount: 0 })),
    );
    await act(async () => {
      await result.current.handleExportConsolidated();
    });
    expect(exportConsolidatedReportPdf).not.toHaveBeenCalled();
  });

  it("exportConsolidated guarda historial con count", async () => {
    exportConsolidatedReportPdf.mockResolvedValue({
      cancelled: false,
      filename: "con.pdf",
    });
    const { result } = renderHook(() =>
      useCampoExport(makeParams({ exportablePanelCount: 2 })),
    );
    await act(async () => {
      await result.current.handleExportConsolidated();
    });
    expect(saveFeatureHistory).toHaveBeenCalledWith(
      "reporte_campo",
      "Panel - consolidado",
      expect.objectContaining({ type: "consolidado", count: 2 }),
      2,
    );
  });

  it("Ctrl+Enter dispara la exportación individual cuando hay fotos", async () => {
    exportReportPdf.mockResolvedValue({ cancelled: false, filename: "x.pdf" });
    renderHook(() => useCampoExport(makeParams()));
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { ctrlKey: true, key: "Enter" }),
      );
    });
    expect(exportReportPdf).toHaveBeenCalled();
  });

  it("Ctrl+Enter sin fotos no exporta", async () => {
    renderHook(() =>
      useCampoExport(makeParams({ photos: [], selectedPanel: null })),
    );
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { ctrlKey: true, key: "Enter" }),
      );
    });
    expect(exportReportPdf).not.toHaveBeenCalled();
  });
});
