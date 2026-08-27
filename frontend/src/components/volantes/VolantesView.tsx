import "./styles.css";
import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { ChangeEvent, DragEvent } from "react";
import SheetPreview from "./components/SheetPreview";
import FloatingSizePanel from "./components/FloatingSizePanel";
import FloatingRecordsPanel from "./components/FloatingRecordsPanel";
import DatePicker from "./components/DatePicker";
import TimePicker from "./components/TimePicker";
import TutorialOverlay from "./components/TutorialOverlay";
import { DEFAULT_BRAND, DEFAULT_ENCABEZADOS, DEFAULT_FOOTER, DEFAULT_HEADING } from "./constants";
import type {
  BrandConfig,
  BulletStyle,
  FooterConfig,
  FlyerEncabezados,
  FlyerHeading,
  FlyerRecord,
  LayoutMode,
} from "./types";
import { sanitizeMultilineText, toSlugId } from "./utils/format";
import {
  appendPagesToPdf,
  chunkExportItems,
  createPdfDocument,
  exportPagesToPdf,
  PDF_EXPORT_BATCH_SIZE,
  savePdfDocument,
} from "./utils/pdf";
import { importSpreadsheet, exportTemplateWorkbook } from "./utils/import";
import { useToast } from "../../hooks/useToast";
import { saveFeatureHistory } from "../../utils/history";
import { WithHoverTooltip } from "@/components/ui/HoverTooltip";

interface BulletOption {
  id: BulletStyle;
  label: string;
  renderIcon: () => React.ReactNode;
}

const BULLET_OPTIONS: BulletOption[] = [
  {
    id: "none",
    label: "Sin viñeta",
    renderIcon: () => (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
        <line x1="3" y1="6" x2="21" y2="6" />
        <line x1="3" y1="12" x2="21" y2="12" />
        <line x1="3" y1="18" x2="21" y2="18" />
      </svg>
    ),
  },
  {
    id: "disc",
    label: "Punto (•)",
    renderIcon: () => (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
        <line x1="9" y1="6" x2="21" y2="6" />
        <line x1="9" y1="12" x2="21" y2="12" />
        <line x1="9" y1="18" x2="21" y2="18" />
        <circle cx="4" cy="6" r="1.5" fill="currentColor" />
        <circle cx="4" cy="12" r="1.5" fill="currentColor" />
        <circle cx="4" cy="18" r="1.5" fill="currentColor" />
      </svg>
    ),
  },
  {
    id: "dash",
    label: "Guión (–)",
    renderIcon: () => (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
        <line x1="10" y1="6" x2="21" y2="6" />
        <line x1="10" y1="12" x2="21" y2="12" />
        <line x1="10" y1="18" x2="21" y2="18" />
        <line x1="3" y1="6" x2="6" y2="6" />
        <line x1="3" y1="12" x2="6" y2="12" />
        <line x1="3" y1="18" x2="6" y2="18" />
      </svg>
    ),
  },
  {
    id: "arrow",
    label: "Flecha (▸)",
    renderIcon: () => (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <line x1="10" y1="6" x2="21" y2="6" />
        <line x1="10" y1="12" x2="21" y2="12" />
        <line x1="10" y1="18" x2="21" y2="18" />
        <polyline points="3 4 6 6 3 8" />
        <polyline points="3 10 6 12 3 14" />
        <polyline points="3 16 6 18 3 20" />
      </svg>
    ),
  },
  {
    id: "check",
    label: "Check (✓)",
    renderIcon: () => (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <line x1="11" y1="6" x2="21" y2="6" />
        <line x1="11" y1="12" x2="21" y2="12" />
        <line x1="11" y1="18" x2="21" y2="18" />
        <polyline points="3 6 5 8 8 4" />
        <polyline points="3 12 5 14 8 10" />
        <polyline points="3 18 5 20 8 16" />
      </svg>
    ),
  },
  {
    id: "number",
    label: "Numerado (1, 2, 3...)",
    renderIcon: () => (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <line x1="10" y1="6" x2="21" y2="6" />
        <line x1="10" y1="12" x2="21" y2="12" />
        <line x1="10" y1="18" x2="21" y2="18" />
        <path d="M4 5v5" />
        <path d="M3 6l1-1" />
        <path d="M3 10h2" />
        <path d="M6 18H3c0-1.2 2-1.8 2-2.5s-.8-1.5-1.5-1.5" />
      </svg>
    ),
  },
];

const defaultBrand: BrandConfig = {
  logoIzquierdo: DEFAULT_BRAND.logoIzquierdo,
  logoDerecho: DEFAULT_BRAND.logoDerecho,
};

const defaultFooter: FooterConfig = {
  logoOperativo: DEFAULT_FOOTER.logoOperativo,
  servicioAgua: DEFAULT_FOOTER.servicioAgua,
};

const defaultHeading: FlyerHeading = {
  titulo: DEFAULT_HEADING.titulo,
  subtitulo: DEFAULT_HEADING.subtitulo,
};

const defaultEncabezados: FlyerEncabezados = {
  limpiezaReservorios: DEFAULT_ENCABEZADOS.limpiezaReservorios,
  zonasAfectadas: DEFAULT_ENCABEZADOS.zonasAfectadas,
  detalleZonas: DEFAULT_ENCABEZADOS.detalleZonas,
};

const LOGO_MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const LOGO_ALLOWED_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/bmp",
]);
// Reuse a single FileReader per slot so a quick re-pick aborts the previous
// in-flight decode instead of racing two onload callbacks.
const imageReaders: Record<string, FileReader | null> = {
  logoIzquierdo: null,
  logoDerecho: null,
  logoOperativo: null,
  servicioAgua: null,
};

function readImageAsDataUrl(
  slotKey: string,
  file: File,
  onError: (message: string) => void,
  onResult: (dataUrl: string) => void,
): void {
  if (!LOGO_ALLOWED_TYPES.has(file.type)) {
    onError("La imagen debe ser PNG, JPEG, WebP, GIF o BMP.");
    return;
  }
  if (file.size > LOGO_MAX_BYTES) {
    onError(`La imagen no puede superar 5 MB (recibido: ${(file.size / 1024 / 1024).toFixed(1)} MB).`);
    return;
  }
  let reader = imageReaders[slotKey];
  if (reader) {
    try { reader.abort(); } catch { /* already complete */ }
  }
  reader = new FileReader();
  imageReaders[slotKey] = reader;
  reader.onload = () => {
    if (typeof reader.result === "string") onResult(reader.result);
    else onError("No se pudo leer la imagen.");
  };
  reader.onerror = () => onError("Error leyendo el archivo de imagen.");
  reader.readAsDataURL(file);
}

export default function VolantesView() {
  const { addToast } = useToast();
  const [records, setRecords] = useState<FlyerRecord[]>([]);
  const [brand, setBrand] = useState<BrandConfig>(defaultBrand);
  const [footer, setFooter] = useState<FooterConfig>(defaultFooter);
  const [heading, setHeading] = useState<FlyerHeading>(defaultHeading);
  const [encabezados, setEncabezados] =
    useState<FlyerEncabezados>(defaultEncabezados);
  const [layoutMode, setLayoutMode] = useState<LayoutMode>("2-up");
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);
  const [filterText, setFilterText] = useState("");
  const [pendingExport, setPendingExport] = useState<{
    record: FlyerRecord;
    mode: LayoutMode;
  } | null>(null);
  const [isSizePanelOpen, setIsSizePanelOpen] = useState(false);
  const [isRecordsPanelOpen, setIsRecordsPanelOpen] = useState(false);
  const [isTutorialOpen, setIsTutorialOpen] = useState(false);

  const exportSingleRef = useRef<HTMLDivElement | null>(null);

  const selectedRecord =
    records.find((record) => record.id === selectedRecordId) ??
    records[0] ??
    null;

  /* ── pending single-record export ── */
  useEffect(() => {
    if (!pendingExport) return;
    let cancelled = false;

    const doExport = async () => {
      await new Promise((r) => setTimeout(r, 300));
      if (cancelled) return;
      const container = exportSingleRef.current;
      if (!container) {
        if (!cancelled) setPendingExport(null);
        return;
      }

      try {
        const layoutNum = pendingExport.mode === "2-up" ? "2" : "3";
        const fileName = `${pendingExport.record.reservorio}_${layoutNum}`;
        await exportPagesToPdf(container, pendingExport.mode, fileName);
        await saveFeatureHistory(
          "volante",
          fileName,
          { layoutMode: pendingExport.mode, reservorio: pendingExport.record.reservorio, single: true },
          1,
        );
      } catch (error) {
        if (!cancelled) {
          const message =
            error instanceof Error ? error.message : "No se pudo generar el PDF.";
          addToast({ message, type: "error" });
        }
      } finally {
        if (!cancelled) setPendingExport(null);
      }
    };

    doExport();
    return () => { cancelled = true; };
  }, [pendingExport, addToast]);

  /* ── handlers ── */
  const updateSelectedRecord = (
    patch: Partial<Omit<FlyerRecord, "id">>,
  ): void => {
    if (!selectedRecord) return;
    setRecords((current) =>
      current.map((record) =>
        record.id === selectedRecord.id ? { ...record, ...patch } : record,
      ),
    );
  };

  const handleLogoChange =
    (side: keyof BrandConfig) => (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;
      readImageAsDataUrl(
        side,
        file,
        (message) => addToast({ message, type: "error" }),
        (dataUrl) => setBrand((current) => ({ ...current, [side]: dataUrl })),
      );
      event.target.value = "";
    };

  const handleLogoDragOver = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
  };

  const handleLogoDrop =
    (side: keyof BrandConfig) => (event: DragEvent<HTMLLabelElement>) => {
      event.preventDefault();
      const file = event.dataTransfer.files?.[0];
      if (!file) return;
      readImageAsDataUrl(
        side,
        file,
        (message) => addToast({ message, type: "error" }),
        (dataUrl) => setBrand((current) => ({ ...current, [side]: dataUrl })),
      );
    };

  const handleFooterChange =
    (key: keyof FooterConfig) => (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;
      readImageAsDataUrl(
        key,
        file,
        (message) => addToast({ message, type: "error" }),
        (dataUrl) => setFooter((current) => ({ ...current, [key]: dataUrl })),
      );
      event.target.value = "";
    };

  const handleFooterDrop =
    (key: keyof FooterConfig) => (event: DragEvent<HTMLLabelElement>) => {
      event.preventDefault();
      const file = event.dataTransfer.files?.[0];
      if (!file) return;
      readImageAsDataUrl(
        key,
        file,
        (message) => addToast({ message, type: "error" }),
        (dataUrl) => setFooter((current) => ({ ...current, [key]: dataUrl })),
      );
    };

  const handleImport = async (
    event: ChangeEvent<HTMLInputElement>,
  ): Promise<void> => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const result = await importSpreadsheet(file);
      setRecords(result.records);
      setSelectedRecordId(result.records[0]?.id ?? null);
      setIsRecordsPanelOpen(false);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "No se pudo importar el archivo.";
      addToast({ message, type: "error" });
    } finally {
      event.target.value = "";
    }
  };

  const handleAddRecord = (): void => {
    const today = new Date().toISOString().slice(0, 10);
    const newRecord: FlyerRecord = {
      id: toSlugId(),
      distrito: "NUEVO DISTRITO",
      fecha: today,
      horaInicio: "08:00",
      horaFin: "16:00",
      reservorio: "NUEVO RESERVORIO",
      sector: "NUEVO SECTOR",
      zonasAfectadas: "Ingrese aqui el detalle de las zonas afectadas.",
    };
    setRecords((current) => [newRecord, ...current]);
    setSelectedRecordId(newRecord.id);
    setIsRecordsPanelOpen(false);
  };

  const handleDeleteRecord = (recordId: string): void => {
    setRecords((current) => {
      const nextRecords = current.filter((record) => record.id !== recordId);
      if (selectedRecordId === recordId) {
        setSelectedRecordId(nextRecords[0]?.id ?? null);
      }
      return nextRecords;
    });
  };

  const handleExportAllPdf = async (): Promise<void> => {
    if (records.length === 0) {
      addToast({ message: "No hay contenido para exportar.", type: "error" });
      return;
    }

    const recordsToExport = records;
    const exportLayout = layoutMode;
    const exportRecord = selectedRecord;
    const layoutNum = exportLayout === "2-up" ? "2" : "3";
    const fileName = exportRecord
      ? `${exportRecord.reservorio}_${layoutNum}`
      : `volantes_${layoutNum}`;
    let wrapper: HTMLDivElement | null = null;
    let root: ReturnType<typeof createRoot> | null = null;

    try {
      const pdf = await createPdfDocument();
      wrapper = document.createElement("div");
      wrapper.className = "sheet-export-root";
      document.body.appendChild(wrapper);
      root = createRoot(wrapper);

      const batches = chunkExportItems(recordsToExport, PDF_EXPORT_BATCH_SIZE);
      for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
        flushSync(() => {
          root?.render(
            <SheetPreview
              brand={brand}
              footer={footer}
              encabezados={encabezados}
              heading={heading}
              exportMode
              layoutMode={exportLayout}
              records={batches[batchIndex]}
            />,
          );
        });

        await appendPagesToPdf(wrapper, pdf, batchIndex > 0);
        flushSync(() => root?.render(null));
        await new Promise((resolve) => setTimeout(resolve, 0));
      }

      savePdfDocument(pdf, exportLayout, fileName);
      addToast({ message: "PDF generado correctamente", type: "success" });
      await saveFeatureHistory(
        "volante",
        fileName,
        { layoutMode: exportLayout, reservorio: exportRecord?.reservorio || "", records: recordsToExport.length },
        recordsToExport.length,
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "No se pudo generar el PDF.";
      addToast({ message, type: "error" });
    } finally {
      root?.unmount();
      wrapper?.remove();
    }
  };

  const handleExportSingle = (record: FlyerRecord, mode: LayoutMode): void => {
    setPendingExport({ record, mode });
  };

  const handleExportTemplate = async (): Promise<void> => {
    try {
      await exportTemplateWorkbook();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "No se pudo exportar la plantilla.";
      addToast({ message, type: "error" });
    }
  };

  /* ── render ── */
  return (
    <div className="vgen-app">
      <header className="vgen-header">
        <div className="vgen-brand">
          <span className="vgen-badge">{records.length} registros</span>
        </div>

        <div className="vgen-layout-toggle" role="group">
          <button
            className={layoutMode === "2-up" ? "active" : ""}
            onClick={() => setLayoutMode("2-up")}
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <rect x="4" y="4" width="16" height="6" rx="1" />
              <rect x="4" y="14" width="16" height="6" rx="1" />
            </svg>
            2 por hoja
          </button>
          <button
            className={layoutMode === "3-up" ? "active" : ""}
            onClick={() => setLayoutMode("3-up")}
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <rect x="4" y="3" width="16" height="4" rx="1" />
              <rect x="4" y="10" width="16" height="4" rx="1" />
              <rect x="4" y="17" width="16" height="4" rx="1" />
            </svg>
            3 por hoja
          </button>
        </div>

        <div className="vgen-header-actions">
          <WithHoverTooltip label="Ver tutorial de como usar Generar Volantes" placement="bottom">
            <button
              className="tutorial-trigger-btn"
              onClick={() => setIsTutorialOpen(true)}
              type="button"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <circle cx="12" cy="12" r="10" />
                <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              Como usar
            </button>
          </WithHoverTooltip>
          <WithHoverTooltip label="Descargar Plantilla Excel" placement="bottom">
            <button
              className="v-btn v-btn-outline vgen-btn-template"
              onClick={handleExportTemplate}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
                <polyline points="10 9 9 9 8 9" />
              </svg>
              Plantilla
            </button>
          </WithHoverTooltip>
          <label className="v-btn v-btn-outline vgen-btn-import">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            Importar
            <input
              accept=".xlsx,.xls,.csv"
              onChange={handleImport}
              type="file"
              hidden
            />
          </label>
          <button
            className="v-btn v-btn-primary vgen-btn-export-all"
            onClick={handleExportAllPdf}
            type="button"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Exportar Todo
          </button>
        </div>
      </header>

      <main className="vgen-workspace">
        <aside className="vgen-sidebar">
          <div className="vgen-sidebar-content">
            <div className="vgen-fade-in">
              {selectedRecord ? (
                <div className="vgen-editor">
                  <div className="vgen-section vgen-section-logos">
                    <div className="vgen-logos-grid">
                      <label
                        className="v-upload-box"
                        onDragOver={handleLogoDragOver}
                        onDrop={handleLogoDrop("logoIzquierdo")}
                      >
                        {brand.logoIzquierdo ? (
                          <img
                            src={brand.logoIzquierdo}
                            alt="Logo izquierdo"
                            className="v-upload-preview"
                          />
                        ) : (
                          <>
                            <svg
                              width="16"
                              height="16"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.5"
                            >
                              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                              <polyline points="17 8 12 3 7 8" />
                              <line x1="12" y1="3" x2="12" y2="15" />
                            </svg>
                            <span>Izquierdo</span>
                          </>
                        )}
                        <input
                          accept="image/*"
                          onChange={handleLogoChange("logoIzquierdo")}
                          type="file"
                          hidden
                        />
                      </label>
                      <label
                        className="v-upload-box"
                        onDragOver={handleLogoDragOver}
                        onDrop={handleLogoDrop("logoDerecho")}
                      >
                        {brand.logoDerecho ? (
                          <img
                            src={brand.logoDerecho}
                            alt="Logo derecho"
                            className="v-upload-preview"
                          />
                        ) : (
                          <>
                            <svg
                              width="16"
                              height="16"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.5"
                            >
                              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                              <polyline points="17 8 12 3 7 8" />
                              <line x1="12" y1="3" x2="12" y2="15" />
                            </svg>
                            <span>Derecho</span>
                          </>
                        )}
                        <input
                          accept="image/*"
                          onChange={handleLogoChange("logoDerecho")}
                          type="file"
                          hidden
                        />
                      </label>
                    </div>
                  </div>

                  <div className="vgen-section">
                    <div className="vgen-group-title">Textos</div>
                    <div className="vgen-inset-list">
                      <div className="vgen-inset-row">
                        <label className="vgen-inset-label" htmlFor="vgen-titulo">Título</label>
                        <input
                          id="vgen-titulo"
                          className="vgen-inset-input"
                          onChange={(e) =>
                            setHeading((current) => ({
                              ...current,
                              titulo: e.target.value,
                            }))
                          }
                          value={heading.titulo}
                        />
                      </div>
                      <div className="vgen-inset-row">
                        <label className="vgen-inset-label" htmlFor="vgen-subtitulo">Subtítulo</label>
                        <input
                          id="vgen-subtitulo"
                          className="vgen-inset-input"
                          onChange={(e) =>
                            setHeading((current) => ({
                              ...current,
                              subtitulo: e.target.value,
                            }))
                          }
                          value={heading.subtitulo}
                        />
                      </div>
                      <div className="vgen-inset-row">
                        <label className="vgen-inset-label" htmlFor="vgen-enc-limpieza">Limpieza</label>
                        <input
                          id="vgen-enc-limpieza"
                          className="vgen-inset-input"
                          onChange={(e) =>
                            setEncabezados((current) => ({
                              ...current,
                              limpiezaReservorios: e.target.value,
                            }))
                          }
                          value={encabezados.limpiezaReservorios}
                        />
                      </div>
                      <div className="vgen-inset-row">
                        <label className="vgen-inset-label" htmlFor="vgen-enc-zonas">Zonas</label>
                        <input
                          id="vgen-enc-zonas"
                          className="vgen-inset-input"
                          onChange={(e) =>
                            setEncabezados((current) => ({
                              ...current,
                              zonasAfectadas: e.target.value,
                            }))
                          }
                          value={encabezados.zonasAfectadas}
                        />
                      </div>
                      <div className="vgen-inset-row">
                        <label className="vgen-inset-label" htmlFor="vgen-enc-detalle">Detalle</label>
                        <input
                          id="vgen-enc-detalle"
                          className="vgen-inset-input"
                          onChange={(e) =>
                            setEncabezados((current) => ({
                              ...current,
                              detalleZonas: e.target.value,
                            }))
                          }
                          value={encabezados.detalleZonas}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="vgen-section">
                    <div className="vgen-group-title">Datos</div>
                    <div className="vgen-inset-list">
                      <div className="vgen-inset-row">
                        <label className="vgen-inset-label" htmlFor="vgen-distrito">Distrito</label>
                        <input
                          id="vgen-distrito"
                          className="vgen-inset-input"
                          onChange={(e) =>
                            updateSelectedRecord({
                              distrito: e.target.value.toUpperCase(),
                            })
                          }
                          value={selectedRecord.distrito}
                        />
                      </div>
                      <div className="vgen-inset-row">
                        <label className="vgen-inset-label" htmlFor="vgen-reservorio">Reservorio</label>
                        <input
                          id="vgen-reservorio"
                          className="vgen-inset-input"
                          onChange={(e) =>
                            updateSelectedRecord({
                              reservorio: e.target.value.toUpperCase(),
                            })
                          }
                          value={selectedRecord.reservorio}
                        />
                      </div>
                      <div className="vgen-inset-row">
                        <label className="vgen-inset-label" htmlFor="vgen-sector">Sector</label>
                        <input
                          id="vgen-sector"
                          className="vgen-inset-input"
                          onChange={(e) =>
                            updateSelectedRecord({
                              sector: e.target.value,
                            })
                          }
                          value={selectedRecord.sector}
                        />
                      </div>
                    </div>
                    <div className="vgen-compact-schedule">
                      <DatePicker
                        label="Fecha"
                        value={selectedRecord.fecha}
                        onChange={(value) =>
                          updateSelectedRecord({ fecha: value })
                        }
                      />
                      <TimePicker
                        label="Inicio"
                        value={selectedRecord.horaInicio}
                        onChange={(value) =>
                          updateSelectedRecord({ horaInicio: value })
                        }
                      />
                      <TimePicker
                        label="Fin"
                        align="end"
                        value={selectedRecord.horaFin}
                        onChange={(value) =>
                          updateSelectedRecord({ horaFin: value })
                        }
                      />
                    </div>
                  </div>

                  <div className="vgen-section">
                    <div className="vgen-group-title">Zonas afectadas</div>
                    <textarea
                      className="vgen-input vgen-textarea-compact"
                      onChange={(e) =>
                        updateSelectedRecord({
                          zonasAfectadas: sanitizeMultilineText(
                            e.target.value,
                          ),
                        })
                      }
                      value={selectedRecord.zonasAfectadas}
                    />
                    <div className="vgen-bullet-toolbar" role="group" aria-label="Estilo de viñetas">
                      {BULLET_OPTIONS.map((opt) => (
                        <WithHoverTooltip key={opt.id} label={opt.label} placement="bottom">
                          <button
                            type="button"
                            className={`vgen-bullet-btn${
                              (selectedRecord.bulletStyle ?? "none") === opt.id ? " active" : ""
                            }`}
                            onClick={() =>
                              updateSelectedRecord({ bulletStyle: opt.id })
                            }
                            aria-label={opt.label}
                          >
                            {opt.renderIcon()}
                          </button>
                        </WithHoverTooltip>
                      ))}
                    </div>
                    <div className="vgen-district-color-row" role="group" aria-label="Color pastilla distrito">
                      {[
                        "#55caeb",
                        "#1a9fc4",
                        "#18416d",
                        "#2ecc71",
                        "#e67e22",
                        "#e74c3c",
                        "#9b59b6",
                        "#f1c40f",
                      ].map((preset) => (
                        <WithHoverTooltip key={preset} label={preset} placement="bottom">
                          <button
                            type="button"
                            className={`vgen-color-swatch${
                              (selectedRecord.districtColor ?? "#55caeb") === preset
                                ? " active"
                                : ""
                            }`}
                            style={{ background: preset }}
                            onClick={() =>
                              updateSelectedRecord({ districtColor: preset })
                            }
                            aria-label={`Color ${preset}`}
                          />
                        </WithHoverTooltip>
                      ))}
                      <WithHoverTooltip label="Color personalizado" placement="bottom">
                        <label
                          className="vgen-color-swatch vgen-color-custom"
                          style={{
                          background:
                            selectedRecord.districtColor &&
                            ![
                              "#55caeb","#1a9fc4","#18416d","#2ecc71",
                              "#e67e22","#e74c3c","#9b59b6","#f1c40f",
                            ].includes(selectedRecord.districtColor)
                              ? selectedRecord.districtColor
                              : "conic-gradient(red,yellow,lime,aqua,blue,magenta,red)",
                        }}
                      >
                        <input
                          type="color"
                          value={selectedRecord.districtColor ?? "#55caeb"}
                          onChange={(e) =>
                            updateSelectedRecord({ districtColor: e.target.value })
                          }
                          style={{ opacity: 0, position: "absolute", width: 0, height: 0 }}
                        />
                        </label>
                      </WithHoverTooltip>
                    </div>
                  </div>

                  <div className="vgen-section">
                    <div className="vgen-group-title">Footer</div>
                    <div className="vgen-logos-grid">
                      <label
                        className="v-upload-box"
                        onDragOver={handleLogoDragOver}
                        onDrop={handleFooterDrop("logoOperativo")}
                        title="Cambiar Logo operativo"
                      >
                        {footer.logoOperativo ? (
                          <img
                            src={footer.logoOperativo}
                            alt="Logo operativo"
                            className="v-upload-preview"
                          />
                        ) : (
                          <>
                            <svg
                              width="16"
                              height="16"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.5"
                            >
                              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                              <polyline points="17 8 12 3 7 8" />
                              <line x1="12" y1="3" x2="12" y2="15" />
                            </svg>
                            <span>Logo operativo</span>
                          </>
                        )}
                        <input
                          accept="image/*"
                          onChange={handleFooterChange("logoOperativo")}
                          type="file"
                          hidden
                        />
                      </label>
                      <label
                        className="v-upload-box"
                        onDragOver={handleLogoDragOver}
                        onDrop={handleFooterDrop("servicioAgua")}
                        title="Cambiar Servicio de agua"
                      >
                        {footer.servicioAgua ? (
                          <img
                            src={footer.servicioAgua}
                            alt="Servicio de agua"
                            className="v-upload-preview"
                          />
                        ) : (
                          <>
                            <svg
                              width="16"
                              height="16"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.5"
                            >
                              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                              <polyline points="17 8 12 3 7 8" />
                              <line x1="12" y1="3" x2="12" y2="15" />
                            </svg>
                            <span>Servicio de agua</span>
                          </>
                        )}
                        <input
                          accept="image/*"
                          onChange={handleFooterChange("servicioAgua")}
                          type="file"
                          hidden
                        />
                      </label>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="vgen-empty-state">
                  <svg
                    width="44"
                    height="44"
                    viewBox="0 0 24 24"
                    fill="none"
                    className="vgen-icon-muted"
                    stroke="currentColor"
                    strokeWidth="1"
                  >
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <path d="M3 9h18" />
                    <path d="M9 21V9" />
                  </svg>
                  <p>
                    No hay un registro seleccionado. Usa el widget de Lotes
                    para seleccionar o crear uno nuevo.
                  </p>
                </div>
              )}
            </div>
          </div>
        </aside>

        <section className="vgen-canvas">
          <SheetPreview
            brand={brand}
            footer={footer}
            encabezados={encabezados}
            heading={heading}
            layoutMode={layoutMode}
            records={selectedRecord ? [selectedRecord] : []}
          />

          {/* Hidden: single-record export (individual download) */}
          <div
            aria-hidden="true"
            className="sheet-export-root"
            ref={exportSingleRef}
          >
            {pendingExport && (
              <SheetPreview
                brand={brand}
                footer={footer}
                encabezados={encabezados}
                heading={heading}
                exportMode
                layoutMode={pendingExport.mode}
                records={[pendingExport.record]}
              />
            )}
          </div>
        </section>

        <FloatingSizePanel
          isOpen={isSizePanelOpen}
          onClose={() => setIsSizePanelOpen(false)}
          selectedRecord={selectedRecord}
          layoutMode={layoutMode}
          onUpdateRecord={updateSelectedRecord}
        />
      </main>

      {selectedRecord && (
        <WithHoverTooltip label="Configurar tamaño de textos" placement="bottom">
          <button
            className={`vgen-fab vgen-fab-size ${isSizePanelOpen ? "active" : ""}`}
            onClick={() => setIsSizePanelOpen(!isSizePanelOpen)}
            type="button"
            aria-label="Configurar tamaño de textos"
          >
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
          {isSizePanelOpen && (
            <svg
              className="vgen-fab-check"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          )}
          </button>
        </WithHoverTooltip>
      )}

      <FloatingRecordsPanel
        isOpen={isRecordsPanelOpen}
        onClose={() => setIsRecordsPanelOpen(false)}
        records={records}
        selectedRecordId={selectedRecordId}
        filterText={filterText}
        onFilterChange={setFilterText}
        onSelectRecord={(id) => {
          setSelectedRecordId(id);
        }}
        onAddRecord={handleAddRecord}
        onDeleteRecord={handleDeleteRecord}
        onExportSingle={handleExportSingle}
      />

      <TutorialOverlay
        isOpen={isTutorialOpen}
        onClose={() => setIsTutorialOpen(false)}
      />

      <WithHoverTooltip label="Gestionar lotes" placement="bottom">
        <button
          className={`vgen-fab vgen-fab-records ${isRecordsPanelOpen ? "active" : ""}`}
          onClick={() => setIsRecordsPanelOpen(!isRecordsPanelOpen)}
          type="button"
          aria-label="Gestionar lotes"
        >
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M3 9h18" />
          <path d="M9 21V9" />
        </svg>
        {isRecordsPanelOpen && (
          <svg
            className="vgen-fab-check"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        )}
        <span className="vgen-fab-count">{records.length}</span>
        </button>
      </WithHoverTooltip>
    </div>
  );
}
