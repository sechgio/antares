import "./technical-reports.css";
import { WithHoverTooltip } from "@/components/ui/HoverTooltip";
import {
  Download,
  FilePlus2,
  Files,
  RefreshCw,
  Trash2,
  Upload,
} from "lucide-react";
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
          <Button
            variant="none"
            size="none"
            className="tr-secondary"
            onClick={createReport}
            disabled={busy}
          >
            <FilePlus2 size={16} />
            Nuevo
          </Button>
          <Button
            variant="none"
            size="none"
            className="tr-primary"
            onClick={exportCurrent}
            disabled={!formData || busy}
          >
            <Download size={16} />
            PDF
          </Button>
          <Button
            variant="none"
            size="none"
            className="tr-secondary"
            onClick={exportConsolidated}
            disabled={reports.length === 0 || busy}
          >
            <Files size={16} />
            Consolidado
          </Button>
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
