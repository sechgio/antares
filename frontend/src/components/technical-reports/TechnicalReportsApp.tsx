import './technical-reports.css';
import { WithHoverTooltip } from '@/components/ui/HoverTooltip';
import { Database, Download, Eye, FilePlus2, Files, PenLine, RefreshCw, Trash2, Upload } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useReportWorkspace } from '../../hooks/useReportWorkspace';
import { useToast } from '../../hooks/useToast';
import DatabasePanel from './DatabasePanel';
import FormPanel from './FormPanel';
import PreviewPanel from './PreviewPanel';
import { downloadBase64Pdf, fileToDataUrl, technicalReportsApi } from './api';
import { saveFeatureHistory } from '../../utils/history';

export default function TechnicalReportsApp() {
  const { addToast } = useToast();
  const {
    reports,
    selectedId,
    formData,
    setFormData,
    hasChanges,
    busy,
    setBusy,
    mobileTab,
    setMobileTab,
    importInputRef,
    patchForm,
    markClean,
    loadReports,
    selectReport,
    createReport,
    saveReport,
    deleteReport,
    clearReports,
    importFile,
  } = useReportWorkspace(technicalReportsApi);
  const [logoLeft, setLogoLeft] = useState<string | null>(null);
  const [logoRight, setLogoRight] = useState<string | null>(null);

  const changeLogo = useCallback(async (side: 'left' | 'right', file: File | null) => {
    if (!file) {
      if (side === 'left') setLogoLeft(null);
      else setLogoRight(null);
      return;
    }
    try {
      const url = await fileToDataUrl(file);
      if (side === 'left') setLogoLeft(url);
      else setLogoRight(url);
    } catch (error) {
      addToast({ message: error instanceof Error ? error.message : 'No se pudo cargar el logo', type: 'error' });
    }
  }, [addToast]);

  const exportCurrent = useCallback(async () => {
    if (!formData) return;
    setBusy(true);
    try {
      const reportForRender = hasChanges
        ? await technicalReportsApi.update(formData.id, formData)
        : formData;
      if (hasChanges) {
        setFormData(reportForRender);
        markClean();
        await loadReports();
      }
      const rendered = await technicalReportsApi.renderHtml({
        id: reportForRender.id,
        report: reportForRender,
        logo_left: logoLeft,
        logo_right: logoRight,
      });
      const pdf = await technicalReportsApi.htmlToPdf({
        html: rendered.html,
        filename: rendered.filename,
        return_base64: true,
      });
      if (!pdf.pdf_base64) throw new Error('No se recibio el contenido del PDF generado.');
      downloadBase64Pdf(pdf.pdf_base64, pdf.filename);
      await saveFeatureHistory('informe_tecnico', pdf.filename, { type: 'individual', reportId: reportForRender.id });
      addToast({ message: hasChanges ? 'Informe guardado y PDF generado' : 'PDF generado', type: 'success' });
    } catch (error) {
      addToast({ message: error instanceof Error ? error.message : 'No se pudo generar el PDF', type: 'error' });
    } finally {
      setBusy(false);
    }
  }, [addToast, formData, hasChanges, loadReports, logoLeft, logoRight, markClean, setBusy, setFormData]);

  const exportConsolidated = useCallback(async () => {
    if (reports.length === 0) return;
    setBusy(true);
    try {
      const rendered = await technicalReportsApi.renderConsolidatedHtml({ logo_left: logoLeft, logo_right: logoRight });
      const pdf = await technicalReportsApi.htmlToPdf({
        html: rendered.html,
        filename: rendered.filename,
        return_base64: true,
      });
      if (!pdf.pdf_base64) throw new Error('No se recibio el contenido del PDF generado.');
      downloadBase64Pdf(pdf.pdf_base64, pdf.filename);
      await saveFeatureHistory('informe_tecnico', pdf.filename, { type: 'consolidado', count: rendered.count }, rendered.count);
      addToast({ message: `PDF consolidado generado (${rendered.count})`, type: 'success' });
    } catch (error) {
      addToast({ message: error instanceof Error ? error.message : 'No se pudo generar el consolidado', type: 'error' });
    } finally {
      setBusy(false);
    }
  }, [addToast, logoLeft, logoRight, reports.length, setBusy]);

  return (
    <div className="tr-app" data-surface="technical-reports">
      <header className="tr-header">
        <h1>INFORMES TÉCNICOS</h1>
        <div className="tr-header-toolbar">
          <div className="tr-header-actions">
            <button type="button" className="tr-secondary" disabled={busy} onClick={() => importInputRef.current?.click()}>
              <Upload size={16} />
              Importar
            </button>
            <WithHoverTooltip label="Recargar" placement="bottom">
              <button type="button" className="tr-secondary tr-icon-button" disabled={busy} onClick={() => void loadReports()}>
                <RefreshCw size={16} />
              </button>
            </WithHoverTooltip>
            <WithHoverTooltip label="Eliminar todos" placement="bottom">
              <button type="button" className="tr-danger tr-icon-button" disabled={busy || reports.length === 0} onClick={() => void clearReports()}>
                <Trash2 size={16} />
              </button>
            </WithHoverTooltip>
            <button type="button" className="tr-secondary" onClick={createReport} disabled={busy}>
              <FilePlus2 size={16} />
              Nuevo
            </button>
            <button type="button" className="tr-primary" onClick={exportCurrent} disabled={!formData || busy}>
              <Download size={16} />
              PDF
            </button>
            <button type="button" className="tr-secondary" onClick={exportConsolidated} disabled={reports.length === 0 || busy}>
              <Files size={16} />
              Consolidado
            </button>
          </div>
        </div>
        <input
          ref={importInputRef}
          className="hidden"
          type="file"
          accept=".csv,.xlsx"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void importFile(file);
          }}
        />
      </header>

      <nav className="tr-mobile-tabs" role="tablist" aria-label="Vista de informes técnicos">
        <button type="button" role="tab" aria-selected={mobileTab === 'db'} className={`tr-mobile-tab${mobileTab === 'db' ? ' is-active' : ''}`} onClick={() => setMobileTab('db')}>
          <Database size={14} />
          <span>Informes</span>
        </button>
        <button type="button" role="tab" aria-selected={mobileTab === 'preview'} className={`tr-mobile-tab${mobileTab === 'preview' ? ' is-active' : ''}`} onClick={() => setMobileTab('preview')}>
          <Eye size={14} />
          <span>Vista previa</span>
        </button>
        <button type="button" role="tab" aria-selected={mobileTab === 'form'} className={`tr-mobile-tab${mobileTab === 'form' ? ' is-active' : ''}`} onClick={() => setMobileTab('form')}>
          <PenLine size={14} />
          <span>Editar</span>
        </button>
      </nav>

      <div className="tr-workspace" data-mobile-tab={mobileTab}>
        <DatabasePanel
          reports={reports}
          selectedId={selectedId}
          onSelect={selectReport}
        />
        <PreviewPanel report={formData} logoLeft={logoLeft} logoRight={logoRight} />
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
      </div>
    </div>
  );
}
