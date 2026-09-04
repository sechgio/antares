import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DialogProvider } from "../../hooks/useDialog";
import { ToastProvider } from "../../hooks/useToast";
import Dialog from "../ui/Dialog";
import { DEFAULT_BRAND, DEFAULT_ENCABEZADOS, DEFAULT_FOOTER, DEFAULT_HEADING } from "./constants";
import VolantesView from "./VolantesView";
import type { FlyerRecord, VolantesDraft } from "./types";
import { clearVolantesDraft, loadVolantesDraft, saveVolantesDraft } from "./utils/storage";

const record: FlyerRecord = {
  id: "flyer-ui-1",
  distrito: "SURCO",
  fecha: "2026-09-03",
  horaInicio: "08:00",
  horaFin: "16:00",
  reservorio: "R-UI",
  sector: "SECTOR UI",
  zonasAfectadas: "Zona UI",
};

const savedDraft: VolantesDraft = {
  records: [record],
  brand: { ...DEFAULT_BRAND },
  footer: { ...DEFAULT_FOOTER },
  heading: { ...DEFAULT_HEADING },
  encabezados: { ...DEFAULT_ENCABEZADOS },
  layoutMode: "2-up",
  selectedRecordId: record.id,
};

function renderVolantesView() {
  return render(
    <ToastProvider>
      <DialogProvider>
        <VolantesView />
        <Dialog />
      </DialogProvider>
    </ToastProvider>,
  );
}

describe("VolantesView persistence controls", () => {
  beforeEach(() => {
    vi.stubGlobal("indexedDB", undefined);
    localStorage.clear();
  });

  afterEach(async () => {
    await clearVolantesDraft();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("restores a saved record and lets the user clear the whole draft", async () => {
    await saveVolantesDraft(savedDraft);
    renderVolantesView();

    expect(await screen.findByDisplayValue("R-UI")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Limpiar", exact: true }));
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();

    const clearButtons = screen.getAllByRole("button", { name: "Limpiar", exact: true });
    fireEvent.click(clearButtons[clearButtons.length - 1]);

    await waitFor(() => expect(screen.queryByDisplayValue("R-UI")).not.toBeInTheDocument());
    await expect(loadVolantesDraft()).resolves.toBeNull();
  });
});
