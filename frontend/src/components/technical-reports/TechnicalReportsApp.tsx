import './technical-reports.css';
import { ChevronLeft, ChevronRight, Download, FilePlus2, Files } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useDialog } from '../../hooks/useDialog';
import { useToast } from '../../hooks/useToast';
import DatabasePanel from './DatabasePanel';
import FormPanel from './FormPanel';
import PreviewPanel from './PreviewPanel';
import { downloadBase64Pdf, fileToBase64, fileToDataUrl, technicalReportsApi } from './api';
import type { TechnicalReport, TechnicalReportListItem } from './types';

export default function TechnicalReportsApp() {
  const { addToast } = useToast();
  const dialog = useDialog();
  const [reports, setReports] = useState<TechnicalReportListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [formData, setFormData] = useState<TechnicalReport | null>(null);
  const [savedSnapshot, setSavedSnapshot] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [logoLeft, setLogoLeft] = useState<string | null>(null);
  const [logoRight, setLogoRight] = useState<string | null>(null);

  const hasChanges = useMemo(() => Boolean(formData && JSON.stringify(formData) !== savedSnapshot), [formData, savedSnapshot]);
  const currentIndex = useMemo(() => reports.findIndex((report) => report.id === selectedId), [reports, selectedId]);

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
    setBusy(true);
    try {
      const report = await technicalReportsApi.get(id);
      setSelectedId(id);
      setFormData(report);
      setSavedSnapshot(JSON.stringify(report));
    } catch (error) {
      addToast({ message: error instanceof Error ? error.message : 'No se pudo abrir el informe', type: 'error' });
    } finally {
      setBusy(false);
    }
  }, [addToast, dialog, hasChanges]);

  const createReport = useCallback(async () => {
    setBusy(true);
    try {
      const report = await technicalReportsApi.create();
      await loadReports();
      setSelectedId(report.id);
      setFormData(report);
      setSavedSnapshot(JSON.stringify(report));
      addToast({ message: 'Informe creado', type: 'success' });
    } catch (error) {
      addToast({ message: error instanceof Error ? error.message : 'No se pudo crear el informe', type: 'error' });
    } finally {
      setBusy(false);
    }
  }, [addToast, loadReports]);

  const saveReport = useCallback(async () => {
    if (!formData) return;
    setBusy(true);
    try {
      await technicalReportsApi.update(formData.id, formData);
      setSavedSnapshot(JSON.stringify(formData));
      await loadReports();
      addToast({ message: 'Informe guardado', type: 'success' });
    } catch (error) {
      addToast({ message: error instanceof Error ? error.message : 'No se pudo guardar', type: 'error' });
    } finally {
      setBusy(false);
    }
  }, [addToast, formData, loadReports]);

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
      setSavedSnapshot('');
      await loadReports();
      addToast({ message: 'Informe eliminado', type: 'success' });
    } catch (error) {
      addToast({ message: error instanceof Error ? error.message : 'No se pudo eliminar', type: 'error' });
    } finally {
      setBusy(false);
    }
  }, [addToast, dialog, loadReports, selectedId]);

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
      setSavedSnapshot('');
      addToast({ message: 'Base de informes limpiada', type: 'success' });
    } catch (error) {
      addToast({ message: error instanceof Error ? error.message : 'No se pudo limpiar la base', type: 'error' });
    } finally {
      setBusy(false);
    }
  }, [addToast, dialog]);

  const importFile = useCallback(async (file: File) => {
    setBusy(true);
    try {
      const content = await fileToBase64(file);
      const result = await technicalReportsApi.importFile(file.name, content);
      setSelectedId(null);
      setFormData(null);
      setSavedSnapshot('');
      await loadReports();
      addToast({ message: `${result.imported_count} informes importados`, type: 'success' });
    } catch (error) {
      addToast({ message: error instanceof Error ? error.message : 'No se pudo importar el archivo', type: 'error' });
    } finally {
      setBusy(false);
    }
  }, [addToast, loadReports]);

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
      const rendered = await technicalReportsApi.renderHtml({ report: formData, logo_left: logoLeft, logo_right: logoRight });
      const pdf = await technicalReportsApi.htmlToPdf({ html: rendered.html, filename: rendered.filename });
      downloadBase64Pdf(pdf.pdf_base64, pdf.filename);
      addToast({ message: 'PDF generado', type: 'success' });
    } catch (error) {
      addToast({ message: error instanceof Error ? error.message : 'No se pudo generar el PDF', type: 'error' });
    } finally {
      setBusy(false);
    }
  }, [addToast, formData, logoLeft, logoRight]);

  const exportConsolidated = useCallback(async () => {
    if (reports.length === 0) return;
    setBusy(true);
    try {
      const rendered = await technicalReportsApi.renderConsolidatedHtml({ logo_left: logoLeft, logo_right: logoRight });
      const pdf = await technicalReportsApi.htmlToPdf({ html: rendered.html, filename: rendered.filename });
      downloadBase64Pdf(pdf.pdf_base64, pdf.filename);
      addToast({ message: `PDF consolidado generado (${rendered.count})`, type: 'success' });
    } catch (error) {
      addToast({ message: error instanceof Error ? error.message : 'No se pudo generar el consolidado', type: 'error' });
    } finally {
      setBusy(false);
    }
  }, [addToast, logoLeft, logoRight, reports.length]);

  const goRelative = (direction: -1 | 1) => {
    const next = reports[currentIndex + direction];
    if (next) void selectReport(next.id);
  };

  return (
    <div className="tr-app">
      <header className="tr-header">
        <div>
          <p className="tr-eyebrow">Herramienta</p>
          <h1>Informes técnicos</h1>
        </div>
        <div className="tr-header-actions">
          <button className="tr-secondary" onClick={() => goRelative(-1)} disabled={currentIndex <= 0 || busy} title="Anterior">
            <ChevronLeft size={16} />
          </button>
          <span className="tr-counter">{selectedId ? `${currentIndex + 1} / ${reports.length}` : 'Sin selección'}</span>
          <button className="tr-secondary" onClick={() => goRelative(1)} disabled={currentIndex < 0 || currentIndex >= reports.length - 1 || busy} title="Siguiente">
            <ChevronRight size={16} />
          </button>
          <button className="tr-secondary" onClick={createReport} disabled={busy}>
            <FilePlus2 size={16} />
            Nuevo
          </button>
          <button className="tr-primary" onClick={exportCurrent} disabled={!formData || busy}>
            <Download size={16} />
            PDF
          </button>
          <button className="tr-secondary" onClick={exportConsolidated} disabled={reports.length === 0 || busy}>
            <Files size={16} />
            Consolidado
          </button>
        </div>
      </header>

      <div className="tr-workspace">
        <DatabasePanel
          reports={reports}
          selectedId={selectedId}
          busy={busy}
          onSelect={selectReport}
          onImport={importFile}
          onReload={loadReports}
          onClear={clearReports}
        />
        <PreviewPanel report={formData} logoLeft={logoLeft} logoRight={logoRight} />
        <FormPanel
          report={formData}
          hasChanges={hasChanges}
          busy={busy}
          logoLeft={logoLeft}
          logoRight={logoRight}
          onChange={setFormData}
          onSave={saveReport}
          onDelete={deleteReport}
          onLogoChange={changeLogo}
        />
      </div>
    </div>
  );
}
