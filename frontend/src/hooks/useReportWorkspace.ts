import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fileToBase64 } from '../utils/pdfAssets';
import { useDialog } from './useDialog';
import { useOperationCoordinator } from './useOperationCoordinator';
import { useToast } from './useToast';
import { errorMessage } from '@/utils/errors';

export interface ReportWorkspaceApi<TReport, TListItem> {
  list: (summary?: boolean) => Promise<{ reports: TListItem[] }>;
  get: (id: string) => Promise<TReport>;
  create: () => Promise<TReport>;
  update: (id: string, report: TReport) => Promise<TReport>;
  delete: (id: string) => Promise<unknown>;
  clear: () => Promise<unknown>;
  importFile: (filename: string, content_b64: string) => Promise<{ imported_count: number }>;
}

export type ReportWorkspaceMobileTab = 'db' | 'preview' | 'form';

interface ReportWorkspaceLabels {
  loadError: string;
  openError: string;
  createError: string;
  createdMessage: string;
  saveError: string;
  savedMessage: string;
  deleteTitle: string;
  deleteDescription: (id: string) => string;
  deleteConfirmLabel: string;
  deleteCancelLabel: string;
  deletedMessage: string;
  deleteError: string;
  clearTitle: string;
  clearDescription: string;
  clearConfirmLabel: string;
  clearCancelLabel: string;
  clearedMessage: string;
  clearError: string;
  importedMessage: (count: number) => string;
  importError: string;
  dirtyTitle: string;
  dirtyDescription: string;
  dirtyConfirmLabel: string;
  dirtyCancelLabel: string;
}

const DEFAULT_LABELS: ReportWorkspaceLabels = {
  loadError: 'No se pudieron cargar los informes',
  openError: 'No se pudo abrir el informe',
  createError: 'No se pudo crear el informe',
  createdMessage: 'Informe creado',
  saveError: 'No se pudo guardar',
  savedMessage: 'Informe guardado',
  deleteTitle: 'Eliminar informe',
  deleteDescription: (id) => `Se eliminará ${id} de la base local.`,
  deleteConfirmLabel: 'Eliminar',
  deleteCancelLabel: 'Cancelar',
  deletedMessage: 'Informe eliminado',
  deleteError: 'No se pudo eliminar',
  clearTitle: 'Eliminar todos los informes',
  clearDescription: 'Esta acción reemplaza la base local con una lista vacía.',
  clearConfirmLabel: 'Eliminar todo',
  clearCancelLabel: 'Cancelar',
  clearedMessage: 'Base de informes limpiada',
  clearError: 'No se pudo limpiar la base',
  importedMessage: (count) => `${count} informes importados`,
  importError: 'No se pudo importar el archivo',
  dirtyTitle: 'Cambios sin guardar',
  dirtyDescription: 'Se perderán los cambios del informe actual.',
  dirtyConfirmLabel: 'Continuar',
  dirtyCancelLabel: 'Seguir editando',
};

export interface ReportWorkspaceOptions<TReport> {
  labels?: Partial<ReportWorkspaceLabels>;
  normalizeItem?: (report: TReport) => TReport;
  formatError?: (error: unknown, fallback: string) => string;
  saveBeforeSelect?: boolean;
  strictRefreshErrors?: boolean;
  draftKey?: string;
  initialMobileTab?: ReportWorkspaceMobileTab;
  focusPreviewOnOpen?: boolean;
}

function defaultFormatError(error: unknown, fallback: string): string {
  return errorMessage(error, fallback);
}

function identity<T>(value: T): T {
  return value;
}

function readWorkspaceDraft<TReport extends { id: string }>(
  key: string,
  normalizeItem: (report: TReport) => TReport,
): { selectedId: string | null; formData: TReport | null } {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return { selectedId: null, formData: null };
    const parsed = JSON.parse(raw) as { selectedId?: string | null; formData?: TReport | null };
    const formData = parsed.formData ? normalizeItem(parsed.formData) : null;
    if (formData && !formData.id) {
      return { selectedId: null, formData: null };
    }
    return {
      selectedId: parsed.selectedId ?? formData?.id ?? null,
      formData,
    };
  } catch {
    return { selectedId: null, formData: null };
  }
}

export function useReportWorkspace<TReport extends { id: string }, TListItem>(
  reportApi: ReportWorkspaceApi<TReport, TListItem>,
  options: ReportWorkspaceOptions<TReport> = {},
) {
  const { addToast } = useToast();
  const dialog = useDialog();
  const labels = useMemo(
    () => ({ ...DEFAULT_LABELS, ...options.labels }),
    [options.labels],
  );
  const normalizeItem = options.normalizeItem ?? identity;
  const formatError = options.formatError ?? defaultFormatError;
  const [draftInitial] = useState(() =>
    options.draftKey ? readWorkspaceDraft(options.draftKey, normalizeItem) : null,
  );
  const [reports, setReports] = useState<TListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(draftInitial?.selectedId ?? null);
  const [formData, setFormData] = useState<TReport | null>(draftInitial?.formData ?? null);
  const [dirtyCount, setDirtyCount] = useState(0);
  const [mobileTab, setMobileTab] = useState<ReportWorkspaceMobileTab>(options.initialMobileTab ?? 'db');
  const importInputRef = useRef<HTMLInputElement>(null);
  const sessionGenRef = useRef(0);
  const formDataRef = useRef<TReport | null>(formData);
  const { busy, runOperation } = useOperationCoordinator();
  formDataRef.current = formData;

  useEffect(() => {
    if (!options.draftKey) return;
    try {
      localStorage.setItem(options.draftKey, JSON.stringify({ selectedId, formData }));
    } catch {
    }
  }, [options.draftKey, selectedId, formData]);

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

  const maybeRefreshReports = useCallback(async () => {
    if (options.strictRefreshErrors) {
      await refreshReports();
    } else {
      await refreshReports().catch(() => {});
    }
  }, [options.strictRefreshErrors, refreshReports]);

  const loadReports = useCallback(async () => {
    await runOperation(async () => {
      try {
        await refreshReports();
      } catch (error) {
        addToast({ message: formatError(error, labels.loadError), type: 'error' });
      }
    });
  }, [addToast, formatError, labels.loadError, refreshReports, runOperation]);

  useEffect(() => {
    void loadReports();
  }, [loadReports]);

  const persist = useCallback(async (target: TReport): Promise<TReport> => {
    const gen = ++sessionGenRef.current;
    return runOperation(async () => {
      const saved = normalizeItem(await reportApi.update(target.id, target));
      if (gen === sessionGenRef.current && formDataRef.current === target) {
        setFormData(saved);
        markClean();
      }
      await maybeRefreshReports();
      return saved;
    });
  }, [markClean, maybeRefreshReports, normalizeItem, reportApi, runOperation]);

  const selectReport = useCallback(async (id: string) => {
    if (hasChanges) {
      const proceed = await dialog.confirm({
        title: labels.dirtyTitle,
        description: labels.dirtyDescription,
        confirmLabel: labels.dirtyConfirmLabel,
        cancelLabel: labels.dirtyCancelLabel,
      });
      if (!proceed) return;
      if (options.saveBeforeSelect && formData) {
        try {
          const saved = normalizeItem(await reportApi.update(formData.id, formData));
          setFormData(saved);
          markClean();
          await refreshReports();
        } catch (error) {
          addToast({ message: formatError(error, labels.saveError), type: 'error' });
          return;
        }
      }
    }
    const gen = ++sessionGenRef.current;
    await runOperation(async () => {
      try {
        const report = await reportApi.get(id);
        if (gen !== sessionGenRef.current) return;
        setSelectedId(id);
        setFormData(normalizeItem(report));
        markClean();
        if (options.focusPreviewOnOpen) setMobileTab('preview');
      } catch (error) {
        if (gen !== sessionGenRef.current) return;
        addToast({ message: formatError(error, labels.openError), type: 'error' });
      }
    });
  }, [addToast, dialog, formData, formatError, hasChanges, labels, markClean, normalizeItem, options.focusPreviewOnOpen, options.saveBeforeSelect, refreshReports, reportApi, runOperation]);

  const createReport = useCallback(async () => {
    const gen = ++sessionGenRef.current;
    await runOperation(async () => {
      try {
        const report = normalizeItem(await reportApi.create());
        // Un fallo del refresh no debe reportar "No se pudo crear" cuando el
        // informe ya existe: la lista solo queda stale hasta el próximo refresh.
        await maybeRefreshReports();
        if (gen === sessionGenRef.current) {
          setSelectedId(report.id);
          setFormData(report);
          markClean();
          if (options.focusPreviewOnOpen) setMobileTab('preview');
        }
        addToast({ message: labels.createdMessage, type: 'success' });
      } catch (error) {
        addToast({ message: formatError(error, labels.createError), type: 'error' });
      }
    });
  }, [addToast, formatError, labels, markClean, maybeRefreshReports, normalizeItem, options.focusPreviewOnOpen, reportApi, runOperation]);

  const saveReport = useCallback(async () => {
    if (!formData) return;
    try {
      await persist(formData);
      addToast({ message: labels.savedMessage, type: 'success' });
    } catch (error) {
      addToast({ message: formatError(error, labels.saveError), type: 'error' });
    }
  }, [addToast, formatError, formData, labels, persist]);

  const saveCurrent = useCallback(async (): Promise<TReport | null> => {
    if (!formData) return null;
    return persist(formData);
  }, [formData, persist]);

  const deleteReport = useCallback(async () => {
    if (!selectedId) return;
    const confirmed = await dialog.confirm({
      title: labels.deleteTitle,
      description: labels.deleteDescription(selectedId),
      confirmLabel: labels.deleteConfirmLabel,
      cancelLabel: labels.deleteCancelLabel,
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
        addToast({ message: labels.deletedMessage, type: 'success' });
      } catch (error) {
        addToast({ message: formatError(error, labels.deleteError), type: 'error' });
      }
    });
  }, [addToast, dialog, formatError, labels, markClean, refreshReports, reportApi, runOperation, selectedId]);

  const clearReports = useCallback(async () => {
    const confirmed = await dialog.confirm({
      title: labels.clearTitle,
      description: labels.clearDescription,
      confirmLabel: labels.clearConfirmLabel,
      cancelLabel: labels.clearCancelLabel,
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
        if (options.draftKey) {
          try {
            localStorage.removeItem(options.draftKey);
          } catch {
          }
        }
        addToast({ message: labels.clearedMessage, type: 'success' });
      } catch (error) {
        addToast({ message: formatError(error, labels.clearError), type: 'error' });
      }
    });
  }, [addToast, dialog, formatError, labels, markClean, options.draftKey, reportApi, runOperation]);

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
        addToast({ message: labels.importedMessage(result.imported_count), type: 'success' });
      } catch (error) {
        addToast({ message: formatError(error, labels.importError), type: 'error' });
      }
    });
  }, [addToast, formatError, labels, markClean, refreshReports, reportApi, runOperation]);

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
