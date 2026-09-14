import { useCallback, useEffect, useRef, useState } from 'react';
import { fileToBase64 } from '../utils/pdfAssets';
import { useDialog } from './useDialog';
import { useOperationCoordinator } from './useOperationCoordinator';
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
  const [mobileTab, setMobileTab] = useState<'db' | 'preview' | 'form'>('db');
  const importInputRef = useRef<HTMLInputElement>(null);
  const sessionGenRef = useRef(0);
  const formDataRef = useRef<TReport | null>(formData);
  const { busy, runOperation } = useOperationCoordinator();
  formDataRef.current = formData;

  const hasChanges = dirtyCount > 0;

  const patchForm = useCallback((report: TReport) => {
    setFormData(report);
    setDirtyCount((c) => c + 1);
  }, []);

  const markClean = useCallback(() => setDirtyCount(0), []);

  const refreshReports = useCallback(async () => {
    const result = await reportApi.list(true);
    setReports(result.reports || []);
  }, [reportApi]);

  const loadReports = useCallback(async () => {
    await runOperation(async () => {
      try {
        await refreshReports();
      } catch (error) {
        addToast({ message: error instanceof Error ? error.message : 'No se pudieron cargar los informes', type: 'error' });
      }
    });
  }, [addToast, refreshReports, runOperation]);

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
    const gen = ++sessionGenRef.current;
    await runOperation(async () => {
      try {
        const report = await reportApi.get(id);
        if (gen !== sessionGenRef.current) return;
        setSelectedId(id);
        setFormData(report);
        markClean();
      } catch (error) {
        if (gen !== sessionGenRef.current) return;
        addToast({ message: error instanceof Error ? error.message : 'No se pudo abrir el informe', type: 'error' });
      }
    });
  }, [addToast, dialog, hasChanges, markClean, reportApi, runOperation]);

  const createReport = useCallback(async () => {
    const gen = ++sessionGenRef.current;
    await runOperation(async () => {
      try {
        const report = await reportApi.create();
        // Un fallo del refresh no debe reportar "No se pudo crear" cuando el
        // informe ya existe: la lista solo queda stale hasta el próximo refresh.
        await refreshReports().catch(() => {});
        if (gen === sessionGenRef.current) {
          setSelectedId(report.id);
          setFormData(report);
          markClean();
        }
        addToast({ message: 'Informe creado', type: 'success' });
      } catch (error) {
        addToast({ message: error instanceof Error ? error.message : 'No se pudo crear el informe', type: 'error' });
      }
    });
  }, [addToast, markClean, refreshReports, reportApi, runOperation]);

  const persist = useCallback(async (target: TReport): Promise<TReport> => {
    const gen = ++sessionGenRef.current;
    return runOperation(async () => {
      const saved = await reportApi.update(target.id, target);
      if (gen === sessionGenRef.current && formDataRef.current === target) {
        setFormData(saved);
        markClean();
      }
      await refreshReports().catch(() => {});
      return saved;
    });
  }, [markClean, refreshReports, reportApi, runOperation]);

  const saveReport = useCallback(async () => {
    if (!formData) return;
    try {
      await persist(formData);
      addToast({ message: 'Informe guardado', type: 'success' });
    } catch (error) {
      addToast({ message: error instanceof Error ? error.message : 'No se pudo guardar', type: 'error' });
    }
  }, [addToast, formData, persist]);

  const saveCurrent = useCallback(async (): Promise<TReport | null> => {
    if (!formData) return null;
    return persist(formData);
  }, [formData, persist]);

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
    const gen = ++sessionGenRef.current;
    await runOperation(async () => {
      try {
        await reportApi.delete(selectedId);
        if (gen === sessionGenRef.current) {
          setSelectedId(null);
          setFormData(null);
          markClean();
        }
        await refreshReports();
        addToast({ message: 'Informe eliminado', type: 'success' });
      } catch (error) {
        addToast({ message: error instanceof Error ? error.message : 'No se pudo eliminar', type: 'error' });
      }
    });
  }, [addToast, dialog, markClean, refreshReports, reportApi, runOperation, selectedId]);

  const clearReports = useCallback(async () => {
    const confirmed = await dialog.confirm({
      title: 'Eliminar todos los informes',
      description: 'Esta acción reemplaza la base local con una lista vacía.',
      confirmLabel: 'Eliminar todo',
      cancelLabel: 'Cancelar',
      type: 'destructive',
    });
    if (!confirmed) return;
    const gen = ++sessionGenRef.current;
    await runOperation(async () => {
      try {
        await reportApi.clear();
        if (gen === sessionGenRef.current) {
          setReports([]);
          setSelectedId(null);
          setFormData(null);
          markClean();
        }
        addToast({ message: 'Base de informes limpiada', type: 'success' });
      } catch (error) {
        addToast({ message: error instanceof Error ? error.message : 'No se pudo limpiar la base', type: 'error' });
      }
    });
  }, [addToast, dialog, markClean, reportApi, runOperation]);

  const importFile = useCallback(async (file: File) => {
    const gen = ++sessionGenRef.current;
    await runOperation(async () => {
      try {
        const content = await fileToBase64(file);
        const result = await reportApi.importFile(file.name, content);
        if (gen === sessionGenRef.current) {
          setSelectedId(null);
          setFormData(null);
          markClean();
        }
        await refreshReports();
        addToast({ message: `${result.imported_count} informes importados`, type: 'success' });
      } catch (error) {
        addToast({ message: error instanceof Error ? error.message : 'No se pudo importar el archivo', type: 'error' });
      }
    });
  }, [addToast, markClean, refreshReports, reportApi, runOperation]);

  return {
    reports,
    selectedId,
    formData,
    setFormData,
    hasChanges,
    busy,
    runOperation,
    mobileTab,
    setMobileTab,
    importInputRef,
    patchForm,
    markClean,
    loadReports,
    selectReport,
    createReport,
    saveReport,
    saveCurrent,
    deleteReport,
    clearReports,
    importFile,
  };
}
