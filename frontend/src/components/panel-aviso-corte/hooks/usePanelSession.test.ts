import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const computeMatchApi = vi.fn();

vi.mock("../../../api", () => ({
  api: {
    panelAvisoCorteComputeMatch: (...a: unknown[]) => computeMatchApi(...a),
  },
}));

import { usePanelSession } from "./usePanelSession";
import type { ExcelSource } from "../types";

const img = (name: string, type = "image/png", size = 100) =>
  new File([new Uint8Array(size)], name, { type });

const excelSource = (rows: Record<string, string>[] = []): ExcelSource => ({
  filename: "lista.xlsx",
  columns: [
    "ID",
    "Dirección",
    "Cuadrante Afectado",
    "Fecha de Corte",
    "Motivo",
  ],
  normalizedColumns: [
    "id",
    "direccion",
    "cuadrante afectado",
    "fecha de corte",
    "motivo",
  ],
  rows,
  warnings: [],
});

const matchResponse = {
  panels: [
    {
      cuadrante: "C1",
      fecha_corte: "2026-01-01",
      motivo: "m",
      imagenes: [{ filename: "a.png", caption: "cap", position: 1 }],
      source_row_index: 0,
    },
  ],
  summary: {
    total_rows: 1,
    rows_with_images: 1,
    rows_without_images: 0,
    total_images: 1,
    matched_images: 1,
    unmatched_images: 0,
    unmatched_image_names: [],
    rows_without_images_keys: [],
  },
  warnings: [],
};

describe("usePanelSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    computeMatchApi.mockResolvedValue(matchResponse);
  });

  it("setLogo valida tipo y tamaño, y limpia con null", async () => {
    const { result } = renderHook(() => usePanelSession());
    expect(result.current.setLogoLeft(img("x.txt", "text/plain"))).toBe(
      "Archivo de logo inválido",
    );
    expect(
      result.current.setLogoLeft(img("big.png", "image/png", 6 * 1024 * 1024)),
    ).toBe("El logo supera el tamaño máximo de 5 MB");
    let err: string | null = "x";
    act(() => {
      err = result.current.setLogoLeft(img("ok.png"));
    });
    expect(err).toBeNull();
    expect(result.current.logoLeft?.file.name).toBe("ok.png");
    act(() => {
      result.current.setLogoLeft(null);
    });
    expect(result.current.logoLeft).toBeNull();
  });

  it("addImages filtra tipo/tamaño y devuelve errores por imagen grande", async () => {
    const { result } = renderHook(() => usePanelSession());
    let errors: string[] = [];
    await act(async () => {
      errors = await result.current.addImages([
        img("a.png"),
        img("b.txt", "text/plain"),
        img("c.png", "image/png", 16 * 1024 * 1024),
      ]);
    });
    expect(result.current.images.map((i) => i.file.name)).toEqual(["a.png"]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("c.png");
  });

  it("removeImage y clearImages vacían la lista", async () => {
    const { result } = renderHook(() => usePanelSession());
    await act(async () => {
      await result.current.addImages([img("a.png"), img("b.png")]);
    });
    act(() => result.current.removeImage(0));
    expect(result.current.images).toHaveLength(1);
    act(() => result.current.clearImages());
    expect(result.current.images).toHaveLength(0);
  });

  it("setExcelSource puebla header, key column y address column", () => {
    const { result } = renderHook(() => usePanelSession());
    act(() => {
      result.current.setExcelSource(
        excelSource([
          {
            ID: "42",
            Dirección: "Av 1",
            "Cuadrante Afectado": "Norte",
            "Fecha de Corte": "2026-03-05",
            Motivo: "Mantenimiento",
          },
        ]),
      );
    });
    expect(result.current.headerForm).toEqual({
      cuadrante: "Norte",
      fechaCorte: "2026-03-05",
      motivo: "Mantenimiento",
    });
    expect(result.current.matchRule.keyColumn).toBe("ID");
    expect(result.current.addressColumn).toBe("Dirección");
  });

  it("setExcelSource(null) resetea header, regla y columna", () => {
    const { result } = renderHook(() => usePanelSession());
    act(() => {
      result.current.setExcelSource(excelSource([{ ID: "1" }]));
    });
    act(() => {
      result.current.setExcelSource(null);
    });
    expect(result.current.headerForm.cuadrante).toBe("");
    expect(result.current.matchRule.keyColumn).toBe("");
    expect(result.current.addressColumn).toBe("");
  });

  it("computeMatch sin fuentes deja matchResult en null", async () => {
    const { result } = renderHook(() => usePanelSession());
    await act(async () => {
      await result.current.computeMatch();
    });
    expect(computeMatchApi).not.toHaveBeenCalled();
    expect(result.current.matchResult).toBeNull();
  });

  it("computeMatch con excel+imágenes llama a la API y mapea paneles", async () => {
    const { result } = renderHook(() => usePanelSession());
    await act(async () => {
      await result.current.addImages([img("42_foto.png")]);
    });
    act(() => {
      result.current.setExcelSource(excelSource([{ ID: "42" }]));
    });
    await act(async () => {
      await result.current.computeMatch();
    });
    expect(computeMatchApi).toHaveBeenCalledWith(
      expect.objectContaining({
        key_column: "ID",
        strategy: "prefix",
        image_names: ["42_foto.png"],
      }),
    );
    expect(result.current.matchResult?.panels[0].cuadrante).toBe("C1");
    expect(result.current.matchResult?.summary.matchedImages).toBe(1);
    expect(result.current.currentPageIndex).toBe(0);
  });

  it("computeMatch en error registra el mensaje en errors", async () => {
    computeMatchApi.mockRejectedValue(new Error("match falló"));
    const { result } = renderHook(() => usePanelSession());
    await act(async () => {
      await result.current.addImages([img("a.png")]);
    });
    act(() => {
      result.current.setExcelSource(excelSource([{ ID: "1" }]));
    });
    await act(async () => {
      await result.current.computeMatch();
    });
    expect(result.current.errors).toEqual(["match falló"]);
    act(() => result.current.clearErrors());
    expect(result.current.errors).toEqual([]);
  });

  it("computeMatch coalesce llamadas en vuelo en una sola repetición y descarta el resultado viejo", async () => {
    let resolveFirst: (v: typeof matchResponse) => void = () => {};
    const stale = { ...matchResponse, panels: [{ ...matchResponse.panels[0], cuadrante: "VIEJO" }] };
    computeMatchApi
      .mockImplementationOnce(() => new Promise((r) => { resolveFirst = r; }))
      .mockResolvedValue(matchResponse);
    const { result } = renderHook(() => usePanelSession());
    await act(async () => {
      await result.current.addImages([img("42.png")]);
    });
    act(() => {
      result.current.setExcelSource(excelSource([{ ID: "42" }]));
    });
    let first: Promise<void> = Promise.resolve();
    act(() => {
      first = result.current.computeMatch();
    });
    expect(result.current.isMatching).toBe(true);
    await act(async () => {
      await result.current.computeMatch();
      await result.current.computeMatch();
    });
    expect(computeMatchApi).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveFirst(stale);
      await first;
    });
    await waitFor(() => expect(result.current.isMatching).toBe(false));
    expect(computeMatchApi).toHaveBeenCalledTimes(2);
    expect(result.current.matchResult?.panels[0].cuadrante).toBe("C1");
  });

  it("computeMatch apaga isMatching si la repetición sale por una guardia temprana", async () => {
    let resolveFirst: (v: typeof matchResponse) => void = () => {};
    computeMatchApi
      .mockImplementationOnce(() => new Promise((r) => { resolveFirst = r; }))
      .mockResolvedValue(matchResponse);
    const { result } = renderHook(() => usePanelSession());
    await act(async () => {
      await result.current.addImages([img("42.png")]);
    });
    act(() => {
      result.current.setExcelSource(excelSource([{ ID: "42" }]));
    });
    let first: Promise<void> = Promise.resolve();
    act(() => {
      first = result.current.computeMatch();
    });
    expect(result.current.isMatching).toBe(true);
    act(() => {
      result.current.clearImages();
    });
    await act(async () => {
      await result.current.computeMatch();
    });
    await act(async () => {
      resolveFirst(matchResponse);
      await first;
    });
    await waitFor(() => expect(result.current.isMatching).toBe(false));
    expect(computeMatchApi).toHaveBeenCalledTimes(1);
    expect(result.current.matchResult).toBeNull();
  });

  it("computeMatch envía source_id en vez de las filas cuando el Excel tiene sourceId", async () => {
    const { result } = renderHook(() => usePanelSession());
    await act(async () => {
      await result.current.addImages([img("42.png")]);
    });
    act(() => {
      result.current.setExcelSource({ ...excelSource([{ ID: "42" }]), sourceId: "src-1" });
    });
    await act(async () => {
      await result.current.computeMatch();
    });
    const body = computeMatchApi.mock.calls[0][0];
    expect(body.source_id).toBe("src-1");
    expect(body).not.toHaveProperty("rows");
    expect(result.current.matchResult?.panels[0].cuadrante).toBe("C1");
  });

  it("computeMatch reenvía las filas si el backend ya no tiene el Excel en caché", async () => {
    computeMatchApi.mockResolvedValueOnce({ sourceMissing: true });
    const { result } = renderHook(() => usePanelSession());
    await act(async () => {
      await result.current.addImages([img("42.png")]);
    });
    act(() => {
      result.current.setExcelSource({ ...excelSource([{ ID: "42" }]), sourceId: "src-1" });
    });
    await act(async () => {
      await result.current.computeMatch();
    });
    expect(computeMatchApi).toHaveBeenCalledTimes(2);
    expect(computeMatchApi.mock.calls[1][0]).toEqual(
      expect.objectContaining({ rows: [{ ID: "42" }] }),
    );
    expect(computeMatchApi.mock.calls[1][0]).not.toHaveProperty("source_id");
    expect(result.current.matchResult?.panels[0].cuadrante).toBe("C1");
    expect(result.current.errors).toEqual([]);
  });

  it("previewPanels agrupa imágenes de a 4 cuando no hay match ni excel", async () => {
    const { result } = renderHook(() => usePanelSession());
    await act(async () => {
      await result.current.addImages(
        Array.from({ length: 5 }, (_, i) => img(`i${i}.png`)),
      );
    });
    await waitFor(() => expect(result.current.previewPanels).toHaveLength(2));
    expect(result.current.previewPanels[0].imagenes).toHaveLength(4);
    expect(result.current.previewPanels[1].imagenes).toHaveLength(1);
    expect(result.current.previewPanels[0].imagenes[0].caption).toContain(
      "IMAGEN N°1",
    );
  });

  it("previewPanels usa los paneles del match cuando existe", async () => {
    const { result } = renderHook(() => usePanelSession());
    await act(async () => {
      await result.current.addImages([img("42.png")]);
    });
    act(() => {
      result.current.setExcelSource(excelSource([{ ID: "42" }]));
    });
    await waitFor(() => expect(result.current.matchResult).not.toBeNull(), {
      timeout: 2000,
    });
    expect(result.current.previewPanels[0].cuadrante).toBe("C1");
  });
});
