import { describe, expect, it } from "vitest";
import {
  clampCurrentPage,
  clampedSidebarWidth,
  exportablePanelStatus,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  paginatePhotos,
} from "./layoutMath";
import type { PhotoFile } from "../types";

const photo = (name: string): PhotoFile => ({ name }) as PhotoFile;

describe("clampedSidebarWidth", () => {
  it("clampa entre MIN y MAX", () => {
    expect(clampedSidebarWidth(264, 500, "left")).toBe(MAX_SIDEBAR_WIDTH);
    expect(clampedSidebarWidth(264, -500, "left")).toBe(MIN_SIDEBAR_WIDTH);
  });

  it("el lado derecho invierte el delta (drag a la izquierda ensancha)", () => {
    expect(clampedSidebarWidth(264, -40, "right")).toBe(304);
    expect(clampedSidebarWidth(264, 40, "right")).toBe(224);
  });
});

describe("paginatePhotos", () => {
  it("sin fotos devuelve una página vacía", () => {
    const { chunks, totalPages } = paginatePhotos([], 6);
    expect(chunks).toEqual([[]]);
    expect(totalPages).toBe(1);
  });

  it("reparte fotos en páginas de itemsPerPage", () => {
    const photos = Array.from({ length: 8 }, (_, i) => photo(`p${i}`));
    const { chunks, totalPages } = paginatePhotos(photos, 6);
    expect(totalPages).toBe(2);
    expect(chunks[0]).toHaveLength(6);
    expect(chunks[1]).toHaveLength(2);
  });
});

describe("clampCurrentPage", () => {
  it("conserva la página si sigue dentro de rango", () => {
    expect(clampCurrentPage(1, 3)).toBe(1);
  });

  it("cae a la última página cuando el total se reduce", () => {
    expect(clampCurrentPage(5, 2)).toBe(1);
    expect(clampCurrentPage(0, 0)).toBe(0);
  });
});

describe("exportablePanelStatus", () => {
  it('sin paneles exportables dice "Sin fotos"', () => {
    expect(exportablePanelStatus(0)).toBe("Sin fotos");
  });

  it("singular y plural", () => {
    expect(exportablePanelStatus(1)).toBe("1 panel listo");
    expect(exportablePanelStatus(3)).toBe("3 paneles listos");
  });
});
