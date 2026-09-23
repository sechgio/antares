import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const loadSession = vi.fn().mockResolvedValue(null);
const saveSession = vi.fn().mockResolvedValue(undefined);
const storedToSession = vi.fn((s: unknown) => s);

vi.mock("../utils/storage", () => ({
  loadSession: () => loadSession(),
  saveSession: (s: unknown) => saveSession(s),
  storedToSession: (s: unknown) => storedToSession(s),
}));

import { useEvidenciaSession } from "./useEvidenciaSession";

const img = (name: string, type = "image/png", size = 100) =>
  new File([new Uint8Array(size)], name, { type });

describe("useEvidenciaSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadSession.mockResolvedValue(null);
  });

  it("arranca con defaults y una página vacía", async () => {
    const { result } = renderHook(() => useEvidenciaSession());
    await waitFor(() => expect(saveSession).toHaveBeenCalled());
    expect(result.current.title).toContain("");
    expect(result.current.pages).toEqual([[]]);
    expect(result.current.totalPages).toBe(1);
    expect(result.current.cuadranteRanges).toHaveLength(1);
  });

  it("restaura la sesión guardada", async () => {
    loadSession.mockResolvedValue({
      title: "T Guardado",
      cuadranteLabel: "C:",
      showCuadranteLabel: false,
      cuadranteRanges: [{ id: "r1", fromPage: 1, toPage: 2, cuadrante: "Q1" }],
      logoLeft: null,
      logoRight: null,
      images: [],
      updatedAt: 1,
    });
    const { result } = renderHook(() => useEvidenciaSession());
    await waitFor(() => expect(result.current.title).toBe("T Guardado"));
    expect(result.current.cuadranteRanges[0].cuadrante).toBe("Q1");
  });

  it("setLogo valida tipo/tamaño y revoca al reemplazar", async () => {
    const { result } = renderHook(() => useEvidenciaSession());
    await waitFor(() => expect(saveSession).toHaveBeenCalled());
    expect(result.current.setLogo("left", img("x.txt", "text/plain"))).toBe(
      "Archivo de logo inválido",
    );
    expect(
      result.current.setLogo(
        "left",
        img("big.png", "image/png", 6 * 1024 * 1024),
      ),
    ).toBe("El logo supera el tamaño máximo de 5 MB");
    act(() => {
      result.current.setLogo("left", img("ok.png"));
    });
    expect(result.current.logoLeft?.file.name).toBe("ok.png");
    act(() => {
      result.current.setLogo("left", null);
    });
    expect(result.current.logoLeft).toBeNull();
  });

  it("addImages separa aceptadas de rechazadas con mensajes", async () => {
    const { result } = renderHook(() => useEvidenciaSession());
    await waitFor(() => expect(saveSession).toHaveBeenCalled());
    let errors: string[] = [];
    await act(async () => {
      errors = await result.current.addImages([
        img("a.png"),
        img("b.txt", "text/plain"),
        img("c.png", "image/png", 16 * 1024 * 1024),
      ]);
    });
    expect(result.current.images).toHaveLength(1);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toContain("Formato no admitido");
    expect(errors[1]).toContain("c.png");
  });

  it("addImages no permite exceder el presupuesto agregado", async () => {
    const { result } = renderHook(() => useEvidenciaSession());
    await waitFor(() => expect(saveSession).toHaveBeenCalled());
    const files = Array.from({ length: 5 }, (_, index) => img(`large-${index}.png`));
    for (const file of files) {
      Object.defineProperty(file, "size", { value: 14 * 1024 * 1024 });
    }
    let errors: string[] = [];

    await act(async () => {
      errors = await result.current.addImages(files);
    });

    expect(result.current.images).toHaveLength(4);
    expect(errors).toEqual(["El peso total de las imágenes no puede superar 64 MB"]);
  });

  it("pagina de a 6 y clampea el índice al borrar imágenes", async () => {
    const { result } = renderHook(() => useEvidenciaSession());
    await waitFor(() => expect(saveSession).toHaveBeenCalled());
    await act(async () => {
      await result.current.addImages(
        Array.from({ length: 7 }, (_, i) => img(`i${i}.png`)),
      );
    });
    expect(result.current.totalPages).toBe(2);
    act(() => result.current.setCurrentPageIndex(1));
    act(() => result.current.removeImage(6));
    await waitFor(() => expect(result.current.totalPages).toBe(1));
    expect(result.current.currentPageIndex).toBe(0);
  });

  it("clearImages vacía y resetea la página", async () => {
    const { result } = renderHook(() => useEvidenciaSession());
    await act(async () => {
      await result.current.addImages([img("a.png"), img("b.png")]);
    });
    act(() => result.current.clearImages());
    expect(result.current.images).toHaveLength(0);
    expect(result.current.currentPageIndex).toBe(0);
  });

  it("addCuadranteRange continúa desde el último toPage", async () => {
    const { result } = renderHook(() => useEvidenciaSession());
    await waitFor(() => expect(saveSession).toHaveBeenCalled());
    await act(async () => {
      await result.current.addImages(
        Array.from({ length: 12 }, (_, i) => img(`i${i}.png`)),
      );
    });
    act(() => {
      result.current.setCuadranteRanges([
        { id: "r1", fromPage: 1, toPage: 1, cuadrante: "Q1" },
      ]);
    });
    act(() => result.current.addCuadranteRange());
    const ranges = result.current.cuadranteRanges;
    expect(ranges).toHaveLength(2);
    expect(ranges[1].fromPage).toBe(2);
  });

  it("resolveCuadrante devuelve el cuadrante del rango de la página", async () => {
    const { result } = renderHook(() => useEvidenciaSession());
    await waitFor(() => expect(saveSession).toHaveBeenCalled());
    act(() => {
      result.current.setCuadranteRanges([
        { id: "r1", fromPage: 1, toPage: 1, cuadrante: "Q1" },
        { id: "r2", fromPage: 2, toPage: 9, cuadrante: "Q2" },
      ]);
    });
    expect(result.current.resolveCuadrante(1)).toBe("Q1");
    expect(result.current.resolveCuadrante(5)).toBe("Q2");
  });

  it("persiste cambios con debounce tras ediciones", async () => {
    const { result } = renderHook(() => useEvidenciaSession());
    await waitFor(() => expect(saveSession).toHaveBeenCalledTimes(1));
    act(() => result.current.setTitle("Nuevo título"));
    await waitFor(() => expect(saveSession).toHaveBeenCalledTimes(2), {
      timeout: 2000,
    });
    const lastSession = saveSession.mock.calls.at(-1)?.[0] as { title: string };
    expect(lastSession.title).toBe("Nuevo título");
  });
});
