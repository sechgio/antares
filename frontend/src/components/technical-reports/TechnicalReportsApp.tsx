import "./technical-reports.css";
import { WithHoverTooltip } from "@/components/ui/HoverTooltip";
import {
  ChevronDown,
  Download,
  FilePlus2,
  RefreshCw,
  Trash2,
  Upload,
} from "lucide-react";
import { createPortal } from "react-dom";
import { useAnchoredPopover } from "../../hooks/useAnchoredPopover";
import { useReportWorkspace } from "../../hooks/useReportWorkspace";
import ReportWorkspaceShell from "../report-workspace/ReportWorkspaceShell";
import Button from "../ui/Button";
import DatabasePanel from "./DatabasePanel";
import FormPanel from "./FormPanel";
import PreviewPanel from "./PreviewPanel";
import { technicalReportsApi } from "./api";
import { useTechnicalReportsActions } from "./useTechnicalReportsActions";

export default function TechnicalReportsApp() {
  const {
    reports,
    selectedId,
    formData,
    hasChanges,
    busy,
    runOperation,
    mobileTab,
    setMobileTab,
    importInputRef,
    patchForm,
    loadReports,
    selectReport,
    createReport,
    saveReport,
    saveCurrent,
    deleteReport,
    clearReports,
    importFile,
  } = useReportWorkspace(technicalReportsApi);
  const { logoLeft, logoRight, changeLogo, exportCurrent, exportConsolidated } =
    useTechnicalReportsActions({
      reports,
      formData,
      hasChanges,
      runOperation,
      saveCurrent,
    });
  const {
    isOpen: exportMenuOpen,
    position: exportMenuPosition,
    triggerRef: exportMenuTriggerRef,
    popupRef: exportMenuRef,
    close: closeExportMenu,
    toggle: toggleExportMenu,
  } = useAnchoredPopover<HTMLDivElement>({
    estimatedHeight: 44,
    align: "end",
    direction: "down",
    gap: 4,
    matchTriggerWidth: true,
  });

  return (
    <ReportWorkspaceShell
      title="INFORMES TÉCNICOS"
      surface="technical-reports"
      importInputRef={importInputRef}
      onImportFile={importFile}
      mobileTab={mobileTab}
      onMobileTabChange={setMobileTab}
      dbTabLabel="Informes"
      tabsAriaLabel="Vista de informes técnicos"
      actions={
        <>
          <div className="tr-action-group">
            <WithHoverTooltip label="Importar" placement="bottom">
              <Button
                variant="none"
                size="none"
                className="tr-secondary tr-icon-button"
                disabled={busy}
                onClick={() => importInputRef.current?.click()}
              >
                <Upload size={16} />
              </Button>
            </WithHoverTooltip>
            <WithHoverTooltip label="Recargar" placement="bottom">
              <Button
                variant="none"
                size="none"
                className="tr-secondary tr-icon-button"
                disabled={busy}
                onClick={() => void loadReports()}
              >
                <RefreshCw size={16} />
              </Button>
            </WithHoverTooltip>
            <WithHoverTooltip label="Eliminar todos" placement="bottom">
              <Button
                variant="none"
                size="none"
                className="tr-danger tr-icon-button"
                disabled={busy || reports.length === 0}
                onClick={() => void clearReports()}
              >
                <Trash2 size={16} />
              </Button>
            </WithHoverTooltip>
          </div>
          <Button
            variant="none"
            size="none"
            className="tr-secondary"
            onClick={() => void createReport()}
            disabled={busy}
          >
            <FilePlus2 size={16} />
            Nuevo
          </Button>
          <div ref={exportMenuTriggerRef} className="tr-split">
            <Button
              variant="none"
              size="none"
              className="tr-primary"
              onClick={() => {
                closeExportMenu();
                void exportCurrent();
              }}
              disabled={!formData || busy}
            >
              <Download size={16} />
              PDF
            </Button>
            {reports.length > 0 && (
              <Button
                variant="none"
                size="none"
                className="tr-split-toggle"
                onClick={toggleExportMenu}
                disabled={busy}
                aria-expanded={exportMenuOpen}
                aria-haspopup="menu"
                aria-label="Opciones de exportación"
              >
                <ChevronDown size={14} />
              </Button>
            )}
          </div>
          {exportMenuOpen &&
            exportMenuPosition &&
            createPortal(
              <div
                ref={exportMenuRef}
                role="menu"
                style={{
                  top: exportMenuPosition.top,
                  left: exportMenuPosition.left,
                  width: exportMenuPosition.width,
                }}
                className="tr-menu"
              >
                <Button
                  variant="none"
                  size="none"
                  role="menuitem"
                  className="tr-menu-item"
                  disabled={busy}
                  onClick={() => {
                    closeExportMenu();
                    void exportConsolidated();
                  }}
                >
                  Consolidado
                </Button>
              </div>,
              document.body,
            )}
        </>
      }
    >
      <DatabasePanel
        reports={reports}
        selectedId={selectedId}
        onSelect={selectReport}
      />
      <PreviewPanel
        report={formData}
        logoLeft={logoLeft}
        logoRight={logoRight}
      />
      <FormPanel
        report={formData}
        hasChanges={hasChanges}
        busy={busy}
        logoLeft={logoLeft}
        logoRight={logoRight}
        onChange={patchForm}
        onSave={saveReport}
        onDelete={deleteReport}
        onLogoChange={changeLogo}
      />
    </ReportWorkspaceShell>
  );
}
