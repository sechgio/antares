import { useCallback, useEffect, useRef, useState } from 'react';
import { fileToBase64 } from '../utils/pdfAssets';
import { useDialog } from './useDialog';
import { useToast } from './useToast';

export interface ReportWorkspaceApi<TReport, TListItem> {
  list: (summary?: boolean) => Promise<{ reports: TListItem[] }>;
  get: (id: string) => Promise<TReport>;
  create: () => Promise<TReport>;
  update: (id: string, report: TReport) => Promise<TReport>;
  delete: (id: string) => Promise<unknown>;
  clear: () => Promise<unknown>;
  importFile: (filename: string, content_b64: string) => Promise<{ imported_count: number }>;
}

export function useReportWorkspace<TReport extends { id: string }, TListItem>(
  reportApi: ReportWorkspaceApi<TReport, TListItem>,
) {
  const { addToast } = useToast();
  const dialog = useDialog();
  const [reports, setReports] = useState<TListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [formData, setFormData] = useState<TReport | null>(null);
  const [dirtyCount, setDirtyCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [mobileTab, setMobileTab] = useState<'db' | 'preview' | 'form'>('db');
  const importInputRef = useRef<HTMLInputElement>(null);
  const selectGenRef = useRef(0);

  const hasChanges = dirtyCount > 0;

  const patchForm = useCallback((report: TReport) => {
    setFormData(report);
    setDirtyCount((c) => c + 1);
  }, []);

  const markClean = useCallback(() => setDirtyCount(0), []);

  const loadReports = useCallback(async () => {
    setBusy(true);
    try {
      const result = await reportApi.list(true);
      setReports(result.reports || []);
    } catch (error) {
      addToast({ message: error instanceof Error ? error.message : 'No se pudieron cargar los informes', type: 'error' });
    } finally {
      setBusy(false);
    }
  }, [addToast, reportApi]);

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
      const report = await reportApi.get(id);
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
  }, [addToast, dialog, hasChanges, markClean, reportApi]);

  const createReport = useCallback(async () => {
    setBusy(true);
    try {
      const report = await reportApi.create();
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
  }, [addToast, loadReports, markClean, reportApi]);

  const saveReport = useCallback(async () => {
    if (!formData) return;
    setBusy(true);
    try {
      const saved = await reportApi.update(formData.id, formData);
      setFormData(saved);
      markClean();
      await loadReports();
      addToast({ message: 'Informe guardado', type: 'success' });
    } catch (error) {
      addToast({ message: error instanceof Error ? error.message : 'No se pudo guardar', type: 'error' });
    } finally {
      setBusy(false);
    }
  }, [addToast, formData, loadReports, markClean, reportApi]);

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
      await reportApi.delete(selectedId);
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
  }, [addToast, dialog, loadReports, markClean, reportApi, selectedId]);

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
      await reportApi.clear();
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
  }, [addToast, dialog, markClean, reportApi]);

  const importFile = useCallback(async (file: File) => {
    setBusy(true);
    try {
      const content = await fileToBase64(file);
      const result = await reportApi.importFile(file.name, content);
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
  }, [addToast, loadReports, markClean, reportApi]);

  return {
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
  };
}
