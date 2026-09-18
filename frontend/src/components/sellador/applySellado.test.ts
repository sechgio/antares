import { beforeEach, describe, expect, it, vi } from "vitest";

const dialogSave = vi.fn();
const selladorApply = vi.fn();
const acquireStagedFile = vi.fn();
const fileToBase64 = vi.fn();
const saveFeatureHistory = vi.fn().mockResolvedValue(undefined);

vi.mock("../../api", () => ({
  api: {
    dialogSave: (...a: unknown[]) => dialogSave(...a),
    selladorApply: (...a: unknown[]) => selladorApply(...a),
  },
}));
vi.mock("../../utils/stageFile", () => ({
  acquireStagedFile: (...a: unknown[]) => acquireStagedFile(...a),
}));
vi.mock("../../utils/pdfAssets", () => ({
  fileToBase64: (...a: unknown[]) => fileToBase64(...a),
}));
vi.mock("../../utils/history", () => ({
  saveFeatureHistory: (...a: unknown[]) => saveFeatureHistory(...a),
}));

import { applySellado } from "./applySellado";
import type { ResolvedStampPlacement, StampRect } from "./utils";

const rect: StampRect = { x: 10, y: 20, width: 100, height: 50 };
const placements = [
  { pageNum: 1, rect },
] as unknown as ResolvedStampPlacement[];

function params(overrides: Partial<Parameters<typeof applySellado>[0]> = {}) {
  return {
    pdfFile: new File(["pdf"], "doc.pdf", { type: "application/pdf" }),
    pdfPath: null,
    pdfBase64: null,
    stampFile: new File(["img"], "sello.png", { type: "image/png" }),
    primaryRect: rect,
    resolvedPlacements: placements,
    positions: [{ name: "Posición 1", rect }] as never,
    seed: 42,
    onToast: vi.fn(),
    ...overrides,
  };
}

describe("applySellado", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dialogSave.mockResolvedValue({ paths: ["C:/out/sellado.pdf"] });
    selladorApply.mockResolvedValue({
      filename: "doc_sellado.pdf",
      saved_path: "C:/out/sellado.pdf",
      stamp_count: 1,
      stamped_pages: [1],
      seed: 42,
    });
    acquireStagedFile.mockResolvedValue({ token: "tok-1", release: vi.fn() });
  });

  it("cancela sin hacer nada si el usuario cierra el diálogo", async () => {
    dialogSave.mockResolvedValue({ paths: [] });
    const p = params();
    await applySellado(p);
    expect(selladorApply).not.toHaveBeenCalled();
    expect(p.onToast).not.toHaveBeenCalled();
  });

  it("usa pdf_path directo cuando existe y no lee el archivo", async () => {
    const p = params({ pdfPath: "C:/in/doc.pdf" });
    await applySellado(p);
    const call = selladorApply.mock.calls[0][0] as Record<string, unknown>;
    expect(call.pdf_path).toBe("C:/in/doc.pdf");
    expect(call.stamp_path).toBe("tok-1");
    expect(fileToBase64).not.toHaveBeenCalled();
    expect(saveFeatureHistory).toHaveBeenCalledWith(
      "sellador",
      "doc_sellado.pdf",
      expect.objectContaining({
        stamp_count: 1,
        positions: 1,
        seed: 42,
        source: "doc.pdf",
      }),
      1,
    );
    expect(p.onToast).toHaveBeenCalledWith(
      "PDF guardado: doc_sellado.pdf",
      "success",
    );
  });

  it("usa pdf_b64 cuando ya está en memoria", async () => {
    const p = params({ pdfBase64: "QkFTRTY0" });
    await applySellado(p);
    expect(
      (selladorApply.mock.calls[0][0] as Record<string, unknown>).pdf_b64,
    ).toBe("QkFTRTY0");
  });

  it("cae a base64 cuando el staging del PDF no entrega token", async () => {
    const release = vi.fn();
    acquireStagedFile
      .mockResolvedValueOnce({ token: null, release })
      .mockResolvedValueOnce({ token: "tok-stamp", release: vi.fn() });
    fileToBase64.mockResolvedValue("UERG");
    await applySellado(params());
    expect(release).toHaveBeenCalled();
    const call = selladorApply.mock.calls[0][0] as Record<string, unknown>;
    expect(call.pdf_b64).toBe("UERG");
    expect(call.stamp_path).toBe("tok-stamp");
  });

  it("con staging sin token y PDF grande lanza error con toast", async () => {
    acquireStagedFile.mockResolvedValue({ token: null, release: vi.fn() });
    const big = new File([new Uint8Array(0)], "big.pdf");
    Object.defineProperty(big, "size", { value: 9 * 1024 * 1024 });
    const p = params({ pdfFile: big });
    await applySellado(p);
    expect(selladorApply).not.toHaveBeenCalled();
    expect(p.onToast).toHaveBeenCalledWith(
      expect.stringContaining("demasiado grande"),
      "error",
    );
  });

  it("propaga errores del backend como toast y libera handles", async () => {
    const pdfRelease = vi.fn();
    acquireStagedFile.mockResolvedValue({ token: "tok", release: pdfRelease });
    selladorApply.mockRejectedValue(new Error("backend falló"));
    const p = params();
    await applySellado(p);
    expect(p.onToast).toHaveBeenCalledWith("backend falló", "error");
    expect(pdfRelease).toHaveBeenCalled();
  });
});
