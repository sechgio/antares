import "./styles.css";
import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, DragEvent } from "react";
import SheetPreview from "./components/SheetPreview";
import FloatingSizePanel from "./components/FloatingSizePanel";
import FloatingRecordsPanel from "./components/FloatingRecordsPanel";
import DatePicker from "./components/DatePicker";
import TimePicker from "./components/TimePicker";
import { DEFAULT_BRAND } from "./constants";
import type { BrandConfig, FlyerRecord, LayoutMode } from "./types";
import { sanitizeMultilineText, toSlugId } from "./utils/format";
import { exportPagesToPdf } from "./utils/pdf";
import { importSpreadsheet, exportTemplateWorkbook } from "./utils/import";
import { useToast } from "../../hooks/useToast";
import { api } from "../../api";

async function saveToHistory(runType: string, label: string, details: Record<string, unknown>, count = 1) {
  try {
    await api.historySave({
      run_type: runType,
      files: [label],
      options: details,
      formato: label,
      patron: '',
      calidad: 0,
      resize: null,
      ok_count: count,
      err_count: 0,
    });
  } catch {
    // Silently ignore history save errors so main flow is never blocked
  }
}

const defaultBrand: BrandConfig = {
  logoIzquierdo: DEFAULT_BRAND.logoIzquierdo,
  logoDerecho: DEFAULT_BRAND.logoDerecho,
};

export default function VolantesView() {
  const { addToast } = useToast();
  const [records, setRecords] = useState<FlyerRecord[]>([]);
  const [brand, setBrand] = useState<BrandConfig>(defaultBrand);
  const [layoutMode, setLayoutMode] = useState<LayoutMode>("2-up");
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);
  const [filterText, setFilterText] = useState("");
  const [pendingExport, setPendingExport] = useState<{
    record: FlyerRecord;
    mode: LayoutMode;
  } | null>(null);
  const [isSizePanelOpen, setIsSizePanelOpen] = useState(false);
  const [isRecordsPanelOpen, setIsRecordsPanelOpen] = useState(false);

  const previewRef = useRef<HTMLDivElement | null>(null);
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
        await saveToHistory(
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
      const reader = new FileReader();
      reader.onload = () => {
        setBrand((current) => ({
          ...current,
          [side]: String(reader.result),
        }));
      };
      reader.readAsDataURL(file);
      event.target.value = "";
    };

  const handleLogoDragOver = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
  };

  const handleLogoDrop =
    (side: keyof BrandConfig) => (event: DragEvent<HTMLLabelElement>) => {
      event.preventDefault();
      const file = event.dataTransfer.files?.[0];
      if (!file || !file.type.startsWith("image/")) return;
      const reader = new FileReader();
      reader.onload = () => {
        setBrand((current) => ({
          ...current,
          [side]: String(reader.result),
        }));
      };
      reader.readAsDataURL(file);
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
    const newRecord: FlyerRecord = {
      id: toSlugId(),
      distrito: "NUEVO DISTRITO",
      fecha: "2026-04-03",
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
    if (!previewRef.current) {
      addToast({ message: "No hay contenido para exportar.", type: "error" });
      return;
    }
    try {
      const layoutNum = layoutMode === "2-up" ? "2" : "3";
      const fileName = selectedRecord
        ? `${selectedRecord.reservorio}_${layoutNum}`
        : `volantes_${layoutNum}`;
      await exportPagesToPdf(previewRef.current, layoutMode, fileName);
      addToast({ message: "PDF generado correctamente", type: "success" });
      await saveToHistory(
        "volante",
        fileName,
        { layoutMode, reservorio: selectedRecord?.reservorio || "", records: records.length },
        records.length,
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "No se pudo generar el PDF.";
      addToast({ message, type: "error" });
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
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
          >
            <rect x="3" y="3" width="18" height="18" rx="4" />
            <path d="M9 3v18" />
            <path d="M15 3v18" />
            <path d="M3 9h18" />
            <path d="M3 15h18" />
          </svg>
          <h1>Studio Vgen</h1>
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
          <button
            className="v-btn v-btn-outline"
            onClick={handleExportTemplate}
            title="Descargar Plantilla Excel"
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
          <label className="v-btn v-btn-outline">
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
            className="v-btn v-btn-primary"
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
                    <label className="vgen-label">Logos</label>
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
                              width="20"
                              height="20"
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
                              width="20"
                              height="20"
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
                    <label className="vgen-label">Ubicacion</label>
                    <div className="vgen-section-fields">
                      <div className="vgen-row">
                        <div className="vgen-field vgen-field-13">
                          <label className="vgen-label-sm">Distrito</label>
                          <input
                            className="vgen-input"
                            onChange={(e) =>
                              updateSelectedRecord({
                                distrito: e.target.value.toUpperCase(),
                              })
                            }
                            value={selectedRecord.distrito}
                          />
                        </div>
                        <div className="vgen-field vgen-field-13">
                          <label className="vgen-label-sm">Reservorio</label>
                          <input
                            className="vgen-input"
                            onChange={(e) =>
                              updateSelectedRecord({
                                reservorio: e.target.value.toUpperCase(),
                              })
                            }
                            value={selectedRecord.reservorio}
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="vgen-section">
                    <label className="vgen-label">Programacion</label>
                    <div className="vgen-section-fields">
                      <div className="vgen-row">
                        <div className="vgen-field">
                          <DatePicker
                            label="Fecha"
                            value={selectedRecord.fecha}
                            onChange={(value) =>
                              updateSelectedRecord({ fecha: value })
                            }
                          />
                        </div>
                        <div className="vgen-field">
                          <label className="vgen-label-sm">Sector</label>
                          <input
                            className="vgen-input"
                            onChange={(e) =>
                              updateSelectedRecord({
                                sector: e.target.value,
                              })
                            }
                            value={selectedRecord.sector}
                          />
                        </div>
                      </div>
                      <div className="vgen-row">
                        <div className="vgen-field">
                          <TimePicker
                            label="Inicio"
                            value={selectedRecord.horaInicio}
                            onChange={(value) =>
                              updateSelectedRecord({ horaInicio: value })
                            }
                          />
                        </div>
                        <div className="vgen-field">
                          <TimePicker
                            label="Fin"
                            value={selectedRecord.horaFin}
                            onChange={(value) =>
                              updateSelectedRecord({ horaFin: value })
                            }
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="vgen-section vgen-section-grow">
                    <label className="vgen-label">Zonas Afectadas</label>
                    <textarea
                      className="vgen-input vgen-textarea-flex"
                      onChange={(e) =>
                        updateSelectedRecord({
                          zonasAfectadas: sanitizeMultilineText(
                            e.target.value,
                          ),
                        })
                      }
                      value={selectedRecord.zonasAfectadas}
                    />
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
            layoutMode={layoutMode}
            records={selectedRecord ? [selectedRecord] : []}
          />

          {/* Hidden: all-records export (bulk download) */}
          <div
            aria-hidden="true"
            className="sheet-export-root"
            ref={previewRef}
          >
            <SheetPreview
              brand={brand}
              exportMode
              layoutMode={layoutMode}
              records={records}
            />
          </div>

          {/* Hidden: single-record export (individual download) */}
          <div
            aria-hidden="true"
            className="sheet-export-root"
            ref={exportSingleRef}
          >
            {pendingExport && (
              <SheetPreview
                brand={brand}
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
        <button
          className={`vgen-fab ${isSizePanelOpen ? "active" : ""}`}
          onClick={() => setIsSizePanelOpen(!isSizePanelOpen)}
          title="Configurar tamaño de textos"
          type="button"
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

      <button
        className={`vgen-fab vgen-fab-records ${isRecordsPanelOpen ? "active" : ""}`}
        onClick={() => setIsRecordsPanelOpen(!isRecordsPanelOpen)}
        title="Gestionar lotes"
        type="button"
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
    </div>
  );
}
