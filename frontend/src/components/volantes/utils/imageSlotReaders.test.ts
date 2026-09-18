import { describe, expect, it, vi } from "vitest";
import {
  abortAllImageReaders,
  createFlyerRecord,
  nextSelectedIdAfterDelete,
  readImageAsDataUrl,
} from "./imageSlotReaders";
import type { FlyerRecord } from "../types";

function fileOf(type: string, size: number): File {
  const buf = new Uint8Array(size);
  return new File([buf], "img", { type });
}

describe("readImageAsDataUrl", () => {
  it("rechaza tipos no permitidos sin leer", () => {
    const onError = vi.fn();
    const onResult = vi.fn();
    readImageAsDataUrl(
      "logoIzquierdo",
      fileOf("text/plain", 10),
      onError,
      onResult,
    );
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("PNG"));
    expect(onResult).not.toHaveBeenCalled();
  });

  it("rechaza archivos sobre 5 MB", () => {
    const onError = vi.fn();
    readImageAsDataUrl(
      "logoDerecho",
      fileOf("image/png", 6 * 1024 * 1024),
      onError,
      vi.fn(),
    );
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("5 MB"));
  });

  it("lee una imagen válida como data URL", async () => {
    const onResult = vi.fn();
    const onError = vi.fn();
    readImageAsDataUrl(
      "logoOperativo",
      fileOf("image/png", 32),
      onError,
      onResult,
    );
    await vi.waitFor(() => expect(onResult).toHaveBeenCalled());
    expect(onResult.mock.calls[0][0]).toMatch(/^data:image\/png/);
    expect(onError).not.toHaveBeenCalled();
  });

  it("un segundo read en el mismo slot aborta el reader anterior", () => {
    const abortSpy = vi.spyOn(FileReader.prototype, "abort");
    readImageAsDataUrl(
      "servicioAgua",
      fileOf("image/png", 10),
      vi.fn(),
      vi.fn(),
    );
    readImageAsDataUrl(
      "servicioAgua",
      fileOf("image/png", 10),
      vi.fn(),
      vi.fn(),
    );
    expect(abortSpy).toHaveBeenCalled();
    abortSpy.mockRestore();
  });
});

describe("abortAllImageReaders", () => {
  it("aborta los readers vivos y limpia el registro", () => {
    readImageAsDataUrl(
      "logoIzquierdo",
      fileOf("image/png", 10),
      vi.fn(),
      vi.fn(),
    );
    expect(() => abortAllImageReaders()).not.toThrow();
    // idempotente
    abortAllImageReaders();
  });
});

describe("createFlyerRecord", () => {
  it("genera un registro nuevo con defaults", () => {
    const rec = createFlyerRecord("2026-09-17");
    expect(rec.id).toMatch(/^flyer-/);
    expect(rec.fecha).toBe("2026-09-17");
    expect(rec.distrito).toBe("NUEVO DISTRITO");
    expect(rec.horaInicio).toBe("08:00");
  });
});

describe("nextSelectedIdAfterDelete", () => {
  const records = [{ id: "a" }, { id: "b" }] as FlyerRecord[];

  it("selecciona el primero restante cuando se borra el seleccionado", () => {
    expect(nextSelectedIdAfterDelete(records, "a", "a")).toBe("a");
    const remaining = [{ id: "b" }] as FlyerRecord[];
    expect(nextSelectedIdAfterDelete(remaining, "a", "a")).toBe("b");
  });

  it("conserva la selección si se borra otro registro", () => {
    expect(
      nextSelectedIdAfterDelete([{ id: "b" }] as FlyerRecord[], "a", "b"),
    ).toBe("b");
  });

  it("devuelve null cuando no quedan registros", () => {
    expect(nextSelectedIdAfterDelete([], "a", "a")).toBeNull();
  });
});
