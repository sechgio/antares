import "../technical-reports/technical-reports.css";
import { WithHoverTooltip } from "@/components/ui/HoverTooltip";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  FilePlus2,
  Files,
  RefreshCw,
  Trash2,
  Upload,
} from "lucide-react";
import { useMemo } from "react";
import {
  useReportWorkspace,
  type ReportWorkspaceOptions,
} from "../../hooks/useReportWorkspace";
import ReportWorkspaceShell from "../report-workspace/ReportWorkspaceShell";
import Button from "../ui/Button";
import DatabasePanel from "./DatabasePanel";
import FormPanel from "./FormPanel";
import PreviewPanel from "./PreviewPanel";
import { fichasTecnicasApi } from "./api";
import { formatIpcError } from "./formatIpcError";
import {
  normalizeFicha,
  type FichaTecnica,
  type FichaTecnicaListItem,
} from "./types";
import { useFichasTecnicasActions } from "./useFichasTecnicasActions";

const DRAFT_KEY = "current_ficha_draft";

const WORKSPACE_OPTIONS: ReportWorkspaceOptions<FichaTecnica> = {
  labels: {
    loadError: "No se pudieron cargar las fichas",
    openError: "No se pudo abrir la ficha",
    createError: "No se pudo crear la ficha",
    createdMessage: "Ficha creada",
    savedMessage: "Ficha guardada",
    deleteTitle: "Eliminar ficha",
    deletedMessage: "Ficha eliminada",
    clearTitle: "Eliminar todas las fichas",
    clearDescription: "Esta acción vacía la base local de forma permanente.",
    clearedMessage: "Base de fichas limpiada",
    importedMessage: (count) => `${count} fichas importadas`,
    dirtyDescription: "¿Guardar cambios antes de continuar?",
    dirtyConfirmLabel: "Guardar y continuar",
  },
  normalizeItem: normalizeFicha,
  formatError: formatIpcError,
  saveBeforeSelect: true,
  strictRefreshErrors: true,
  draftKey: DRAFT_KEY,
  initialMobileTab: "preview",
  focusPreviewOnOpen: true,
};

export default function FichasTecnicasApp() {
  const {
    reports: fichas,
    selectedId,
    formData,
    hasChanges,
    busy,
    runOperation,
    mobileTab,
    setMobileTab,
    importInputRef,
    patchForm,
    loadReports: loadFichas,
    selectReport: selectFicha,
    createReport: createFicha,
    saveReport: saveFicha,
    saveCurrent,
    deleteReport: deleteFicha,
    clearReports: clearFichas,
    importFile,
  } = useReportWorkspace<FichaTecnica, FichaTecnicaListItem>(
    fichasTecnicasApi,
    WORKSPACE_OPTIONS,
  );
  const { logoLeft, focusMode, changeLogo, exportCurrent, exportConsolidated } =
    useFichasTecnicasActions({
      fichas,
      formData,
      hasChanges,
      runOperation,
      saveCurrent,
      setMobileTab,
    });

  const currentIndex = useMemo(
    () => fichas.findIndex((ficha) => ficha.id === selectedId),
    [fichas, selectedId],
  );

  const goRelative = (direction: -1 | 1) => {
    const next = fichas[currentIndex + direction];
    if (next) void selectFicha(next.id);
  };

  return (
    <ReportWorkspaceShell
      title="FICHAS TÉCNICAS"
      appClassName="ft-app"
      surface="fichas-tecnicas"
      importInputRef={importInputRef}
      onImportFile={importFile}
      mobileTab={mobileTab}
      onMobileTabChange={setMobileTab}
      dbTabLabel="Fichas"
      tabsAriaLabel="Vista de fichas técnicas"
      workspaceClassName={focusMode ? "is-focus" : undefined}
      workspaceProps={{ "data-focus-mode": focusMode ? "on" : "off" }}
      actions={
        <>
          <Button
            variant="none"
            size="none"
            className="tr-secondary"
            disabled={busy}
            onClick={() => importInputRef.current?.click()}
          >
            <Upload size={16} />
            Importar
          </Button>
          <WithHoverTooltip label="Recargar" placement="bottom">
            <Button
              variant="none"
              size="none"
              className="tr-secondary tr-icon-button"
              disabled={busy}
              onClick={() => void loadFichas()}
            >
              <RefreshCw size={16} />
            </Button>
          </WithHoverTooltip>
          <WithHoverTooltip label="Eliminar todas" placement="bottom">
            <Button
              variant="none"
              size="none"
              className="tr-danger tr-icon-button"
              disabled={busy || fichas.length === 0}
              onClick={() => void clearFichas()}
            >
              <Trash2 size={16} />
            </Button>
          </WithHoverTooltip>
          <Button
            variant="none"
            size="none"
            className="tr-secondary"
            onClick={() => void createFicha()}
            disabled={busy}
          >
            <FilePlus2 size={16} />
            Nuevo
          </Button>
          <WithHoverTooltip
            label={
              formData
                ? "Generar PDF de la ficha actual"
                : "Generar PDF de la plantilla en blanco"
            }
            placement="bottom"
          >
            <Button
              variant="none"
              size="none"
              className="tr-primary"
              onClick={() => void exportCurrent()}
              disabled={busy}
            >
              <Download size={16} />
              {formData ? "PDF" : "Plantilla PDF"}
            </Button>
          </WithHoverTooltip>
          <Button
            variant="none"
            size="none"
            className="tr-secondary"
            onClick={() => void exportConsolidated()}
            disabled={fichas.length === 0 || busy}
          >
            <Files size={16} />
            Consolidado
          </Button>
        </>
      }
      trailing={
        focusMode && (
          <>
            <WithHoverTooltip
              label="Anterior"
              placement="bottom"
              className="fixed left-3 top-1/2 z-50 -translate-y-1/2"
              style={{ position: "fixed" }}
            >
              <Button
                variant="none"
                size="none"
                className="rounded-full bg-[var(--accent-red)] p-3 text-[var(--text-on-accent)] shadow-lg disabled:opacity-40"
                disabled={currentIndex <= 0 || busy}
                onClick={() => goRelative(-1)}
                aria-label="Anterior"
              >
                <ChevronLeft size={28} />
              </Button>
            </WithHoverTooltip>
            <WithHoverTooltip
              label="Siguiente"
              placement="bottom"
              className="fixed right-3 top-1/2 z-50 -translate-y-1/2"
              style={{ position: "fixed" }}
            >
              <Button
                variant="none"
                size="none"
                className="rounded-full bg-[var(--accent-red)] p-3 text-[var(--text-on-accent)] shadow-lg disabled:opacity-40"
                disabled={
                  currentIndex < 0 || currentIndex >= fichas.length - 1 || busy
                }
                onClick={() => goRelative(1)}
                aria-label="Siguiente"
              >
                <ChevronRight size={28} />
              </Button>
            </WithHoverTooltip>
          </>
        )
      }
    >
      {!focusMode && (
        <DatabasePanel
          fichas={fichas}
          selectedId={selectedId}
          onSelect={(id) => void selectFicha(id)}
        />
      )}
      <PreviewPanel ficha={formData} logoLeft={logoLeft} />
      {!focusMode && (
        <FormPanel
          ficha={formData}
          hasChanges={hasChanges}
          busy={busy}
          logoLeft={logoLeft}
          onChange={patchForm}
          onSave={() => void saveFicha()}
          onDelete={() => void deleteFicha()}
          onLogoChange={(file) => void changeLogo(file)}
        />
      )}
    </ReportWorkspaceShell>
  );
}
