import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FlyerRecord } from "../types";
import { clearVolantesDraft, loadVolantesDraft } from "../utils/storage";
import { useVolantesDraft } from "./useVolantesDraft";

const record: FlyerRecord = {
  id: "flyer-hook-1",
  distrito: "COMAS",
  fecha: "2026-09-03",
  horaInicio: "08:00",
  horaFin: "16:00",
  reservorio: "R-HOOK",
  sector: "SECTOR A",
  zonasAfectadas: "Zona de prueba",
};

async function waitForHydration(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("useVolantesDraft", () => {
  beforeEach(() => {
    vi.stubGlobal("indexedDB", undefined);
    localStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(async () => {
    await clearVolantesDraft();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("persists records after a change without waiting for a tab switch", async () => {
    const { result } = renderHook(() => useVolantesDraft());
    await waitForHydration();

    act(() => result.current.setRecords([record]));
    await act(async () => {
      vi.advanceTimersByTime(350);
      await Promise.resolve();
    });

    await expect(loadVolantesDraft()).resolves.toMatchObject({ records: [record] });
  });

  it("flushes the latest record when the interface unmounts", async () => {
    const { result, unmount } = renderHook(() => useVolantesDraft());
    await waitForHydration();

    act(() => result.current.setRecords([record]));
    unmount();

    await expect(loadVolantesDraft()).resolves.toMatchObject({ records: [record] });
  });

  it("clears the draft and prevents the reset state from being saved again", async () => {
    const { result } = renderHook(() => useVolantesDraft());
    await waitForHydration();
    act(() => result.current.setRecords([record]));
    await act(async () => {
      vi.advanceTimersByTime(350);
      await Promise.resolve();
    });

    await act(async () => {
      await result.current.clearDraft();
    });
    act(() => vi.runOnlyPendingTimers());

    expect(result.current.records).toEqual([]);
    await expect(loadVolantesDraft()).resolves.toBeNull();
  });
});
