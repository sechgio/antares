import './technical-reports.css';
import { WithHoverTooltip } from '@/components/ui/HoverTooltip';
import { Database, Download, Eye, FilePlus2, Files, PenLine, RefreshCw, Trash2, Upload } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useDialog } from '../../hooks/useDialog';
import { useToast } from '../../hooks/useToast';
import DatabasePanel from './DatabasePanel';
import FormPanel from './FormPanel';
import PreviewPanel from './PreviewPanel';
import { downloadBase64Pdf, fileToBase64, fileToDataUrl, technicalReportsApi } from './api';
import { saveFeatureHistory } from '../../utils/history';
import type { TechnicalReport, TechnicalReportListItem } from './types';

export default function TechnicalReportsApp() {
  const { addToast } = useToast();
  const dialog = useDialog();
  const [reports, setReports] = useState<TechnicalReportListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [formData, setFormData] = useState<TechnicalReport | null>(null);
  const [dirtyCount, setDirtyCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [logoLeft, setLogoLeft] = useState<string | null>(null);
  const [logoRight, setLogoRight] = useState<string | null>(null);
  const [mobileTab, setMobileTab] = useState<'db' | 'preview' | 'form'>('db');
  const importInputRef = useRef<HTMLInputElement>(null);
  const selectGenRef = useRef(0);

  const hasChanges = dirtyCount > 0;

  const patchForm = useCallback((report: TechnicalReport) => {
    setFormData(report);
    setDirtyCount((c) => c + 1);
  }, []);

  const markClean = useCallback(() => setDirtyCount(0), []);

  const loadReports = useCallback(async () => {
    setBusy(true);
    try {
      const result = await technicalReportsApi.list(true);
      setReports(result.reports || []);
    } catch (error) {
      addToast({ message: error instanceof Error ? error.message : 'No se pudieron cargar los informes', type: 'error' });
    } finally {
      setBusy(false);
    }
  }, [addToast]);

  useEffect(() => {
    void loadReports();
  }, [loadReports]);

  const selectReport = useCallback(async (id: string) => {
    if (hasChanges) {
      const proceed = await dialog.confirm({
        title: 'Cambios sin guardar',
        description: 'Se perderán los cambios del informe actual.',
        confirmLabel: 'Continuar',
        cancelLabel: 'Seguir editando',
      });
      if (!proceed) return;
    }
    const gen = ++selectGenRef.current;
    setBusy(true);
    try {
      const report = await technicalReportsApi.get(id);
      if (gen !== selectGenRef.current) return;
      setSelectedId(id);
      setFormData(report);
      markClean();
    } catch (error) {
      if (gen !== selectGenRef.current) return;
      addToast({ message: error instanceof Error ? error.message : 'No se pudo abrir el informe', type: 'error' });
    } finally {
      if (gen === selectGenRef.current) setBusy(false);
    }
  }, [addToast, dialog, hasChanges, markClean]);

  const createReport = useCallback(async () => {
    setBusy(true);
    try {
      const report = await technicalReportsApi.create();
      await loadReports();
      setSelectedId(report.id);
      setFormData(report);
      markClean();
      addToast({ message: 'Informe creado', type: 'success' });
    } catch (error) {
      addToast({ message: error instanceof Error ? error.message : 'No se pudo crear el informe', type: 'error' });
    } finally {
      setBusy(false);
    }
  }, [addToast, loadReports, markClean]);

  const saveReport = useCallback(async () => {
    if (!formData) return;
    setBusy(true);
    try {
      const saved = await technicalReportsApi.update(formData.id, formData);
      setFormData(saved);
      markClean();
      await loadReports();
      addToast({ message: 'Informe guardado', type: 'success' });
    } catch (error) {
      addToast({ message: error instanceof Error ? error.message : 'No se pudo guardar', type: 'error' });
    } finally {
      setBusy(false);
    }
  }, [addToast, formData, loadReports, markClean]);

  const deleteReport = useCallback(async () => {
    if (!selectedId) return;
    const confirmed = await dialog.confirm({
      title: 'Eliminar informe',
      description: `Se eliminará ${selectedId} de la base local.`,
      confirmLabel: 'Eliminar',
      cancelLabel: 'Cancelar',
      type: 'destructive',
    });
    if (!confirmed) return;
    setBusy(true);
    try {
      await technicalReportsApi.delete(selectedId);
      setSelectedId(null);
      setFormData(null);
      markClean();
      await loadReports();
      addToast({ message: 'Informe eliminado', type: 'success' });
    } catch (error) {
      addToast({ message: error instanceof Error ? error.message : 'No se pudo eliminar', type: 'error' });
    } finally {
      setBusy(false);
    }
  }, [addToast, dialog, loadReports, markClean, selectedId]);

  const clearReports = useCallback(async () => {
    const confirmed = await dialog.confirm({
      title: 'Eliminar todos los informes',
      description: 'Esta acción reemplaza la base local con una lista vacía.',
      confirmLabel: 'Eliminar todo',
      cancelLabel: 'Cancelar',
      type: 'destructive',
    });
    if (!confirmed) return;
    setBusy(true);
    try {
      await technicalReportsApi.clear();
      setReports([]);
      setSelectedId(null);
      setFormData(null);
      markClean();
      addToast({ message: 'Base de informes limpiada', type: 'success' });
    } catch (error) {
      addToast({ message: error instanceof Error ? error.message : 'No se pudo limpiar la base', type: 'error' });
    } finally {
      setBusy(false);
    }
  }, [addToast, dialog, markClean]);

  const importFile = useCallback(async (file: File) => {
    setBusy(true);
    try {
      const content = await fileToBase64(file);
      const result = await technicalReportsApi.importFile(file.name, content);
      setSelectedId(null);
      setFormData(null);
      markClean();
      await loadReports();
      addToast({ message: `${result.imported_count} informes importados`, type: 'success' });
    } catch (error) {
      addToast({ message: error instanceof Error ? error.message : 'No se pudo importar el archivo', type: 'error' });
    } finally {
      setBusy(false);
    }
  }, [addToast, loadReports, markClean]);

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
  }, [addToast, formData, hasChanges, loadReports, logoLeft, logoRight, markClean]);

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
  }, [addToast, logoLeft, logoRight, reports.length]);

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
