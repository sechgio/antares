import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { formatIpcError } from "./formatIpcError";

const addToast = vi.fn();
const confirm = vi.fn();
const fileToDataUrl = vi.fn();
const downloadBase64Pdf = vi.fn();
const saveFeatureHistory = vi.fn().mockResolvedValue(undefined);
const renderHtml = vi.fn();
const htmlToPdf = vi.fn();
const renderConsolidatedHtml = vi.fn();

vi.mock("../../hooks/useToast", () => ({ useToast: () => ({ addToast }) }));
vi.mock("../../hooks/useDialog", () => ({ useDialog: () => ({ confirm }) }));
vi.mock("../../utils/pdfAssets", () => ({
  fileToDataUrl: (...a: unknown[]) => fileToDataUrl(...a),
  downloadBase64Pdf: (...a: unknown[]) => downloadBase64Pdf(...a),
}));
vi.mock("../../utils/history", () => ({
  saveFeatureHistory: (...a: unknown[]) => saveFeatureHistory(...a),
}));
vi.mock("./api", () => ({
  fichasTecnicasApi: {
    renderHtml: (...a: unknown[]) => renderHtml(...a),
    htmlToPdf: (...a: unknown[]) => htmlToPdf(...a),
    renderConsolidatedHtml: (...a: unknown[]) => renderConsolidatedHtml(...a),
  },
}));

import { useFichasTecnicasActions } from "./useFichasTecnicasActions";

function makeWorkspace(overrides: Record<string, unknown> = {}) {
  return {
    fichas: [],
    formData: { id: "f1" } as { id: string } | null,
    hasChanges: false,
    runOperation: async (op: () => Promise<void>) => op(),
    saveCurrent: vi.fn(),
    setMobileTab: vi.fn(),
    ...overrides,
  };
}

describe("formatIpcError", () => {
  it("añade ayuda de reinicio cuando el método IPC no está permitido", () => {
    const msg = formatIpcError(
      new Error("IPC method not allowed: ficha_save"),
      "fb",
    );
    expect(msg).toContain("Cierra TODAS las ventanas");
  });

  it("devuelve el mensaje sin ayuda para errores normales", () => {
    expect(formatIpcError(new Error("otro error"), "fb")).toBe("otro error");
  });

  it("usa el fallback cuando no hay mensaje", () => {
    expect(formatIpcError(null, "fallback-msg")).toBe("fallback-msg");
  });
});

describe("useFichasTecnicasActions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("changeLogo limpia sin file, carga dataUrl con file, y avisa en error", async () => {
    const { result } = renderHook(() =>
      useFichasTecnicasActions(makeWorkspace()),
    );
    fileToDataUrl.mockResolvedValue("data:image/png;base64,logo");
    await act(async () => {
      await result.current.changeLogo(new File(["x"], "l.png"));
    });
    expect(result.current.logoLeft).toBe("data:image/png;base64,logo");
    await act(async () => {
      await result.current.changeLogo(null);
    });
    expect(result.current.logoLeft).toBeNull();
    fileToDataUrl.mockRejectedValue(new Error("boom"));
    await act(async () => {
      await result.current.changeLogo(new File(["x"], "l.png"));
    });
    expect(addToast).toHaveBeenCalledWith(
      expect.objectContaining({ message: "boom", type: "error" }),
    );
  });

  it("exportCurrent sin ficha renderiza plantilla y descarga", async () => {
    renderHtml.mockResolvedValue({ html: "<p>x</p>", filename: "tpl.html" });
    htmlToPdf.mockResolvedValue({ pdf_base64: "UFBE", filename: "tpl.pdf" });
    const { result } = renderHook(() =>
      useFichasTecnicasActions(makeWorkspace({ formData: null })),
    );
    await act(async () => {
      await result.current.exportCurrent();
    });
    expect(renderHtml).toHaveBeenCalledWith(
      expect.objectContaining({ template: true }),
    );
    expect(downloadBase64Pdf).toHaveBeenCalledWith("UFBE", "tpl.pdf");
    expect(saveFeatureHistory).toHaveBeenCalledWith(
      "ficha_tecnica",
      "tpl.pdf",
      { type: "plantilla" },
    );
    expect(addToast).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Plantilla PDF generada" }),
    );
  });

  it("exportCurrent con cambios guarda antes de renderizar", async () => {
    const saveCurrent = vi.fn().mockResolvedValue({ id: "f-saved" });
    renderHtml.mockResolvedValue({ html: "<p>x</p>", filename: "f.html" });
    htmlToPdf.mockResolvedValue({ pdf_base64: "UFBE", filename: "f.pdf" });
    const { result } = renderHook(() =>
      useFichasTecnicasActions(
        makeWorkspace({ hasChanges: true, saveCurrent }),
      ),
    );
    await act(async () => {
      await result.current.exportCurrent();
    });
    expect(saveCurrent).toHaveBeenCalled();
    expect(renderHtml).toHaveBeenCalledWith(
      expect.objectContaining({ id: "f-saved" }),
    );
    expect(saveFeatureHistory).toHaveBeenCalledWith("ficha_tecnica", "f.pdf", {
      type: "individual",
      fichaId: "f-saved",
    });
  });

  it("exportCurrent falla con toast si pdf_base64 viene vacío", async () => {
    renderHtml.mockResolvedValue({ html: "<p>x</p>", filename: "f.html" });
    htmlToPdf.mockResolvedValue({ pdf_base64: "", filename: "f.pdf" });
    const { result } = renderHook(() =>
      useFichasTecnicasActions(makeWorkspace()),
    );
    await act(async () => {
      await result.current.exportCurrent();
    });
    expect(addToast).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "No se recibió el contenido del PDF generado.",
        type: "error",
      }),
    );
  });

  it("exportConsolidated no hace nada sin fichas ni si el usuario cancela", async () => {
    const { result } = renderHook(() =>
      useFichasTecnicasActions(makeWorkspace()),
    );
    await act(async () => {
      await result.current.exportConsolidated();
    });
    expect(renderConsolidatedHtml).not.toHaveBeenCalled();

    confirm.mockResolvedValue(false);
    const ws = makeWorkspace({ fichas: [{ id: "a" }] });
    const { result: r2 } = renderHook(() => useFichasTecnicasActions(ws));
    await act(async () => {
      await r2.current.exportConsolidated();
    });
    expect(renderConsolidatedHtml).not.toHaveBeenCalled();
  });

  it("exportConsolidated genera PDF e historial con count tras confirmar", async () => {
    confirm.mockResolvedValue(true);
    renderConsolidatedHtml.mockResolvedValue({
      html: "<p>c</p>",
      filename: "con.html",
      count: 2,
    });
    htmlToPdf.mockResolvedValue({ pdf_base64: "UFBE", filename: "con.pdf" });
    const { result } = renderHook(() =>
      useFichasTecnicasActions(
        makeWorkspace({ fichas: [{ id: "a" }, { id: "b" }] }),
      ),
    );
    await act(async () => {
      await result.current.exportConsolidated();
    });
    expect(saveFeatureHistory).toHaveBeenCalledWith(
      "ficha_tecnica",
      "con.pdf",
      { type: "consolidado", count: 2 },
      2,
    );
    expect(addToast).toHaveBeenCalledWith(
      expect.objectContaining({ message: "PDF consolidado generado (2)" }),
    );
  });

  it("Ctrl+. alterna el modo foco y lleva la pestaña móvil a preview", async () => {
    const setMobileTab = vi.fn();
    const { result } = renderHook(() =>
      useFichasTecnicasActions(makeWorkspace({ setMobileTab })),
    );
    expect(result.current.focusMode).toBe(false);
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { ctrlKey: true, key: "." }),
      );
    });
    expect(result.current.focusMode).toBe(true);
    expect(setMobileTab).toHaveBeenCalledWith("preview");
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { ctrlKey: true, key: "." }),
      );
    });
    expect(result.current.focusMode).toBe(false);
  });
});
