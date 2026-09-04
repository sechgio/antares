import { render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import VolantesView from "./VolantesView";

vi.mock("./hooks/useVolantesDraft", () => ({
  useVolantesDraft: () => ({
    records: [],
    setRecords: vi.fn(),
    brand: { logoIzquierdo: null, logoDerecho: null },
    setBrand: vi.fn(),
    footer: { logoOperativo: null, servicioAgua: null },
    setFooter: vi.fn(),
    heading: { titulo: "Título", subtitulo: "Subtítulo" },
    setHeading: vi.fn(),
    encabezados: {
      limpiezaReservorios: "Limpieza:",
      zonasAfectadas: "Zonas:",
      detalleZonas: "Detalle:",
    },
    setEncabezados: vi.fn(),
    layoutMode: "2-up",
    setLayoutMode: vi.fn(),
    selectedRecordId: null,
    setSelectedRecordId: vi.fn(),
    persistenceStatus: "saved",
    clearDraft: vi.fn(),
  }),
}));

vi.mock("../../hooks/useToast", () => ({
  useToast: () => ({ addToast: vi.fn() }),
}));

vi.mock("../../hooks/useDialog", () => ({
  useDialog: () => ({ confirm: vi.fn().mockResolvedValue(false) }),
}));

vi.mock("@/components/ui/HoverTooltip", () => ({
  WithHoverTooltip: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("./components/SheetPreview", () => ({
  default: () => <div data-testid="sheet-preview" />,
}));

vi.mock("./components/FloatingSizePanel", () => ({
  default: () => null,
}));

vi.mock("./components/FloatingRecordsPanel", () => ({
  default: () => null,
}));

vi.mock("./components/TutorialOverlay", () => ({
  default: () => null,
}));

vi.mock("./utils/import", () => ({
  importSpreadsheet: vi.fn(),
  exportTemplateWorkbook: vi.fn(),
}));

vi.mock("./utils/pdf", () => ({
  appendPagesToPdf: vi.fn(),
  chunkExportItems: vi.fn(),
  createPdfDocument: vi.fn(),
  exportPagesToPdf: vi.fn(),
  PDF_EXPORT_BATCH_SIZE: 25,
  savePdfDocument: vi.fn(),
}));

vi.mock("../../utils/history", () => ({
  saveFeatureHistory: vi.fn(),
}));

describe("VolantesView actions", () => {
  it("keeps template and import actions available with no selected record", () => {
    render(
      <VolantesView />,
    );

    const header = screen.getByRole("banner");

    expect(within(header).getByRole("button", { name: "Plantilla" })).toBeInTheDocument();
    expect(within(header).getByText("Importar")).toBeInTheDocument();
    expect(screen.getByText(/No hay un registro seleccionado/)).toBeInTheDocument();
  });
});
