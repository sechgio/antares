import { beforeEach, describe, expect, it } from "vitest";
import {
  clearPersistedLogo,
  compressLogoForStorage,
  loadPersistedLogo,
  savePersistedLogo,
} from "./persistedLogo";

describe("persistedLogo storage", () => {
  beforeEach(() => localStorage.clear());

  it("round-trip guarda y carga dataUrl + fileName", () => {
    savePersistedLogo("k", "data:image/png;base64,x", "logo.png");
    expect(loadPersistedLogo("k")).toEqual({
      dataUrl: "data:image/png;base64,x",
      fileName: "logo.png",
    });
  });

  it("carga null sin valor o con JSON corrupto", () => {
    expect(loadPersistedLogo("missing")).toBeNull();
    localStorage.setItem("bad", "{no-json");
    expect(loadPersistedLogo("bad")).toBeNull();
  });

  it("clear elimina la clave", () => {
    savePersistedLogo("k", "d", "f");
    clearPersistedLogo("k");
    expect(loadPersistedLogo("k")).toBeNull();
  });
});

describe("compressLogoForStorage", () => {
  it("pasa sin comprimir archivos no-imagen", async () => {
    const file = new File(["hola"], "doc.txt", { type: "text/plain" });
    const result = await compressLogoForStorage(file);
    expect(result).toMatch(/^data:/);
  });

  it("pasa sin comprimir SVG", async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"></svg>';
    const file = new File([svg], "logo.svg", { type: "image/svg+xml" });
    const result = await compressLogoForStorage(file);
    expect(result).toContain("data:");
  });
});
