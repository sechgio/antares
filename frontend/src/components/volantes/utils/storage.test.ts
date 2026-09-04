import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VolantesDraft } from "../types";
import {
  VOLANTES_DRAFT_STORAGE_KEY,
  clearVolantesDraft,
  draftToStored,
  loadVolantesDraft,
  normalizeStoredDraft,
  saveVolantesDraft,
} from "./storage";

const draft: VolantesDraft = {
  records: [
    {
      id: "flyer-1",
      distrito: "ATE",
      fecha: "2026-09-03",
      horaInicio: "08:00",
      horaFin: "16:00",
      reservorio: "R-01",
      sector: "SECTOR 1",
      zonasAfectadas: "Urb. Principal",
      bulletStyle: "disc",
      districtColor: "#1a9fc4",
      titleSize2up: 110,
    },
  ],
  brand: {
    logoIzquierdo: "data:image/png;base64,left",
    logoDerecho: null,
  },
  footer: {
    logoOperativo: "data:image/png;base64,footer",
    servicioAgua: null,
  },
  heading: {
    titulo: "Título guardado",
    subtitulo: "Subtítulo guardado",
  },
  encabezados: {
    limpiezaReservorios: "Limpieza:",
    zonasAfectadas: "Zonas:",
    detalleZonas: "Detalle:",
  },
  layoutMode: "3-up",
  selectedRecordId: "flyer-1",
};

describe("volantes draft storage", () => {
  beforeEach(() => {
    vi.stubGlobal("indexedDB", undefined);
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("round-trips the complete draft when IndexedDB is unavailable", async () => {
    await saveVolantesDraft(draft);

    await expect(loadVolantesDraft()).resolves.toEqual(draft);
  });

  it("stores the schema version and timestamp separately from draft data", () => {
    const stored = draftToStored(draft, 123);

    expect(stored.version).toBe(1);
    expect(stored.updatedAt).toBe(123);
    expect(stored.records).toEqual(draft.records);
  });

  it("clears the saved draft explicitly", async () => {
    await saveVolantesDraft(draft);
    await clearVolantesDraft();

    await expect(loadVolantesDraft()).resolves.toBeNull();
    expect(localStorage.getItem(VOLANTES_DRAFT_STORAGE_KEY)).toBeNull();
  });

  it("ignores malformed records while keeping a valid draft", () => {
    const normalized = normalizeStoredDraft({
      version: 1,
      updatedAt: 10,
      records: [draft.records[0], { id: "invalid" }],
      brand: draft.brand,
      footer: draft.footer,
      heading: draft.heading,
      encabezados: draft.encabezados,
      layoutMode: draft.layoutMode,
      selectedRecordId: draft.selectedRecordId,
    });

    expect(normalized?.records).toEqual(draft.records);
  });
});
