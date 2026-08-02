import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, ChevronDown, FileDown, FolderOpen, Loader2, Sparkles, Trash2 } from 'lucide-react';
import CropEditor from './CropEditor';
import PreviewWorkspace from './PreviewWorkspace';
import QueuePanel from './QueuePanel';
import SettingsPanel from './SettingsPanel';
import { glassToolbarClass, PillPreset, ToastContainer } from './ui';
import { createImageItem, processImageItem } from './pipeline';
import {
  mapWithConcurrencyLimit,
  resolveImportConcurrency,
  resolveProcessConcurrency,
} from './concurrency';
import { DEFAULT_BATCH_SETTINGS, IMAGE_OPTIMIZER_PRESETS, cloneSettings } from './presets';
import { BatchSettings, CropOffset, ImageItem, PresetId, Toast } from './types';
import {
  arrayBufferToBase64,
  buildExportNameMap,
  buildZipFilename,
  generateId,
  getCropRectangle,
  getDownloadableItems,
  getEligibleItems,
  getPrimaryActionLabel,
  getProcessableItems,
  getStats,
  isItemDirectExport,
  previewFilenames,
  resolveSettingsForItem,
  reorderImageItems,
  revokeItemUrls,
  saveEntriesInChunks,
  syncStaleState,
  downloadBlob,
} from './utils';
import { createStoredZipBlob } from './zip';
import { saveFeatureHistory } from '../../utils/history';
import { api } from '../../api';

export default function ImageOptimizer() {
  const [items, setItems] = useState<ImageItem[]>([]);
  const [settings, setSettings] = useState<BatchSettings>(DEFAULT_BATCH_SETTINGS);
  const [activePresetId, setActivePresetId] = useState<PresetId | null>(null);
  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  const [previewTab, setPreviewTab] = useState<'original' | 'crop' | 'result' | 'compare'>('original');
  const [isDragActive, setIsDragActive] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [processingProgress, setProcessingProgress] = useState({ current: 0, total: 0 });
  const [processingMessage, setProcessingMessage] = useState('');
  const [cropEditorItemId, setCropEditorItemId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'single'>('grid');
  const [downloadMenuOpen, setDownloadMenuOpen] = useState(false);
  const [downloadMenuPosition, setDownloadMenuPosition] = useState<{ top: number; right: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const downloadMenuAnchorRef = useRef<HTMLDivElement>(null);
  const itemsRef = useRef<ImageItem[]>([]);
  const settingsRef = useRef<BatchSettings>(settings);
  const saveCancelledRef = useRef(false);

  const updateDownloadMenuPosition = useCallback(() => {
    const anchor = downloadMenuAnchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    setDownloadMenuPosition({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
  }, []);

  const closeDownloadMenu = useCallback(() => {
    setDownloadMenuOpen(false);
    setDownloadMenuPosition(null);
  }, []);

  const toggleDownloadMenu = useCallback(() => {
    setDownloadMenuOpen((open) => {
      if (open) {
        setDownloadMenuPosition(null);
        return false;
      }
      updateDownloadMenuPosition();
      return true;
    });
  }, [updateDownloadMenuPosition]);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    if (isProcessing) closeDownloadMenu();
  }, [closeDownloadMenu, isProcessing]);

  useEffect(() => {
    if (!downloadMenuOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeDownloadMenu();
    };
    const handleReposition = () => updateDownloadMenuPosition();
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', handleReposition);
    window.addEventListener('scroll', handleReposition, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handleReposition);
      window.removeEventListener('scroll', handleReposition, true);
    };
  }, [closeDownloadMenu, downloadMenuOpen, updateDownloadMenuPosition]);

  useEffect(() => {
    return () => {
      itemsRef.current.forEach((item) => revokeItemUrls(item));
    };
  }, []);

  useEffect(() => {
    if (items.length === 0) {
      setActiveItemId(null);
      return;
    }
    if (!activeItemId || !items.some((item) => item.id === activeItemId)) {
      setActiveItemId(items[0].id);
    }
  }, [activeItemId, items]);

  const addToast = useCallback((message: string, type: Toast['type'] = 'info', duration = 3500) => {
    const id = generateId();
    setToasts((prev) => [...prev, { id, message, type }]);
    if (duration > 0) {
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((toast) => toast.id !== id));
      }, duration);
    }
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const commitItems = useCallback((updater: ImageItem[] | ((prev: ImageItem[]) => ImageItem[])) => {
    setItems((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      return syncStaleState(next, settingsRef.current);
    });
  }, []);

  const commitSettings = useCallback((nextSettings: BatchSettings, presetId: PresetId | null) => {
    settingsRef.current = nextSettings;
    setSettings(nextSettings);
    setActivePresetId(presetId);
    setItems((prev) => syncStaleState(prev, nextSettings));
  }, []);

  const updateSettings = useCallback((updater: (draft: BatchSettings) => void) => {
    const draft = cloneSettings(settingsRef.current);
    updater(draft);
    commitSettings(draft, null);
  }, [commitSettings]);

  const outputFolderLabel = useMemo(() => {
    const folder = settings.export.outputFolder.trim();
    if (!folder) return 'Carpeta de destino';
    return folder.split(/[\\/]/).pop() || folder;
  }, [settings.export.outputFolder]);

  const handlePickOutputFolder = useCallback(async () => {
    try {
      const result = await api.dialogFolder({ title: 'Carpeta de destino', pickOnly: true });
      const folder = result?.folder?.trim();
      if (folder) {
        updateSettings((draft) => { draft.export.outputFolder = folder; });
      }
    } catch (error) {
      console.error('[ImageOptimizer] Error al seleccionar carpeta de destino:', error);
    }
  }, [updateSettings]);

  const updateItem = useCallback((id: string, updater: (item: ImageItem) => ImageItem) => {
    commitItems((prev) => prev.map((item) => {
      if (item.id !== id) return item;
      const next = updater(item);
      return {
        ...next,
        excluded: next.overrides.excluded,
      };
    }));
  }, [commitItems]);

  const handleUpdateCustomFilename = useCallback((id: string, value: string) => {
    updateItem(id, (item) => ({ ...item, overrides: { ...item.overrides, customFilename: value } }));
  }, [updateItem]);

  const handleUpdatePresetOverride = useCallback((id: string, value: PresetId | null) => {
    updateItem(id, (item) => ({ ...item, overrides: { ...item.overrides, presetId: value } }));
  }, [updateItem]);

  const handleToggleSkipCompression = useCallback((id: string, value: boolean) => {
    updateItem(id, (item) => ({ ...item, overrides: { ...item.overrides, skipCompression: value } }));
  }, [updateItem]);

  const handleToggleExcluded = useCallback((id: string, value: boolean) => {
    updateItem(id, (item) => ({ ...item, excluded: value, overrides: { ...item.overrides, excluded: value } }));
  }, [updateItem]);

  const handleClearPresetOverride = useCallback((id: string) => {
    updateItem(id, (item) => ({ ...item, overrides: { ...item.overrides, presetId: null } }));
  }, [updateItem]);

  const handleToggleSelection = useCallback((id: string) => {
    updateItem(id, (item) => ({ ...item, selected: !item.selected }));
  }, [updateItem]);

  const handleOpenCropEditor = useCallback((id?: string) => {
    const targetId = id ?? activeItemId;
    if (targetId) setCropEditorItemId(targetId);
  }, [activeItemId]);

  const processInputFiles = useCallback(async (inputFiles: FileList | File[] | null) => {
    if (!inputFiles || inputFiles.length === 0) return;
    const fileArray = Array.from(inputFiles);
    const validFiles = fileArray.filter((file) => file.type.startsWith('image/') && !file.type.includes('gif'));
    const ignored = fileArray.length - validFiles.length;
    if (ignored > 0) {
      addToast(`${ignored} archivo(s) ignorado(s). Formatos aceptados: JPG, PNG, WEBP, AVIF, BMP.`, 'error', 4500);
    }
    if (validFiles.length === 0) return;

    const createdItems = await mapWithConcurrencyLimit(
      validFiles,
      resolveImportConcurrency(),
      (file) => createImageItem(file),
    );
    commitItems((prev) => [...prev, ...createdItems]);
    setActiveItemId((current) => current || createdItems[0]?.id || null);
    addToast(`${createdItems.length} imagen(es) agregada(s) al lote.`, 'success', 2200);
  }, [addToast, commitItems]);

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setIsDragActive(true);
      return;
    }
    if (e.type === 'dragleave') {
      const next = e.relatedTarget as Node | null;
      if (next && rootRef.current?.contains(next)) return;
      setIsDragActive(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processInputFiles(e.dataTransfer.files);
    }
  }, [processInputFiles]);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processInputFiles(e.target.files);
    }
    e.target.value = '';
  }, [processInputFiles]);

  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files || []).filter((file) => file.type.startsWith('image/'));
      if (files.length > 0) {
        processInputFiles(files);
      }
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [processInputFiles]);

  const activeItem = useMemo(() => items.find((item) => item.id === activeItemId) ?? null, [activeItemId, items]);
  const activeItemSettings = useMemo(() => (activeItem ? resolveSettingsForItem(settings, activeItem) : settings), [activeItem, settings]);
  const activeCropPreview = useMemo(() => {
    if (!activeItem || !activeItem.sourceWidth || !activeItem.sourceHeight) return null;
    if (!activeItemSettings.operations.cropEnabled) return null;
    return getCropRectangle(activeItem.sourceWidth, activeItem.sourceHeight, activeItemSettings.crop.aspectRatio, activeItem.overrides.customCropOffset, activeItemSettings.crop.cropOrigin);
  }, [activeItem, activeItemSettings]);

  const stats = useMemo(() => getStats(items, settings), [items, settings]);
  const selectedCount = stats.selectedCount;
  const activeScope: 'all' | 'selected' = selectedCount > 0 ? 'selected' : 'all';
  const scopedItems = useMemo(() => getEligibleItems(items, activeScope), [activeScope, items]);
  const downloadableItems = useMemo(() => getDownloadableItems(items, settings, activeScope), [activeScope, items, settings]);
  const processableItems = useMemo(() => getProcessableItems(items, settings, activeScope), [activeScope, items, settings]);
  const downloadNameMap = useMemo(() => buildExportNameMap(items, settings), [items, settings]);

  const getExportNameMap = useCallback(
    () => buildExportNameMap(itemsRef.current, settingsRef.current),
    [],
  );
  const previewNames = useMemo(() => {
    const previewSettings = settings.operations.renameEnabled
      ? settings
      : { ...settings, operations: { ...settings.operations, renameEnabled: true } };
    return previewFilenames(previewSettings, items.length);
  }, [items.length, settings]);
  const primaryActionLabel = useMemo(() => getPrimaryActionLabel(scopedItems, settings), [scopedItems, settings]);

  const handleApplyGlobalPreset = useCallback((presetId: PresetId) => {
    const preset = IMAGE_OPTIMIZER_PRESETS.find((item) => item.id === presetId);
    if (!preset) return;
    commitSettings(cloneSettings(preset.settings), presetId);
    addToast(`Preset global aplicado: ${preset.label}.`, 'success', 2200);
  }, [addToast, commitSettings]);

  const handleApplyPresetToSelection = useCallback(() => {
    if (!activePresetId || selectedCount === 0) {
      addToast('Selecciona imagenes y un preset activo para aplicar.', 'info', 2600);
      return;
    }
    commitItems((prev) => prev.map((item) => {
      if (!item.selected) return item;
      return { ...item, overrides: { ...item.overrides, presetId: activePresetId } };
    }));
    addToast('Preset activo aplicado a la seleccion.', 'success', 2200);
  }, [activePresetId, addToast, commitItems, selectedCount]);

  const handleSelectAll = useCallback(() => {
    const allSelected = items.length > 0 && items.every((item) => item.selected);
    commitItems((prev) => prev.map((item) => ({ ...item, selected: !allSelected })));
  }, [commitItems, items]);

  const handleClearSelection = useCallback(() => {
    commitItems((prev) => prev.map((item) => ({ ...item, selected: false })));
  }, [commitItems]);

  const handleReprocessSelected = useCallback(() => {
    if (selectedCount === 0) {
      addToast('No hay imagenes seleccionadas para reprocesar.', 'info', 1800);
      return;
    }
    commitItems((prev) => prev.map((item) => item.selected ? { ...item, status: 'pending', error: undefined, stale: !!item.resultBlob } : item));
    addToast('Seleccion marcada para reprocesar.', 'success', 2000);
  }, [addToast, commitItems, selectedCount]);

  const handleToggleExcludeSelected = useCallback(() => {
    const selectedItems = items.filter((item) => item.selected);
    if (selectedItems.length === 0) {
      addToast('Selecciona una o mas imagenes.', 'info', 1800);
      return;
    }
    const shouldExclude = selectedItems.some((item) => !item.excluded);
    commitItems((prev) => prev.map((item) => item.selected ? {
      ...item,
      excluded: shouldExclude,
      overrides: { ...item.overrides, excluded: shouldExclude },
    } : item));
    addToast(shouldExclude ? 'Seleccion excluida del lote.' : 'Seleccion incluida nuevamente.', 'success', 2200);
  }, [addToast, commitItems, items]);

  const handleRemoveSelected = useCallback(() => {
    const selectedItems = items.filter((item) => item.selected);
    if (selectedItems.length === 0) {
      addToast('No hay imagenes seleccionadas.', 'info', 1800);
      return;
    }
    selectedItems.forEach((item) => revokeItemUrls(item));
    commitItems((prev) => prev.filter((item) => !item.selected));
    addToast(`${selectedItems.length} imagen(es) eliminada(s).`, 'success', 2200);
  }, [addToast, commitItems, items]);

  const handleRemoveItem = useCallback((id: string) => {
    commitItems((prev) => {
      const target = prev.find((item) => item.id === id);
      if (target) revokeItemUrls(target);
      return prev.filter((item) => item.id !== id);
    });
    addToast('Imagen eliminada de la cola.', 'info', 1800);
  }, [addToast, commitItems]);

  const handleReorderItems = useCallback((draggedId: string, targetId: string) => {
    commitItems((prev) => reorderImageItems(prev, draggedId, targetId));
  }, [commitItems]);

  const handleClearAll = useCallback(() => {
    items.forEach((item) => revokeItemUrls(item));
    setItems([]);
    setActiveItemId(null);
    addToast('Cola limpiada.', 'info', 2000);
  }, [addToast, items]);

  const handleSaveCropOffset = useCallback((imageId: string, offset: CropOffset) => {
    updateItem(imageId, (item) => ({ ...item, overrides: { ...item.overrides, customCropOffset: offset } }));
    addToast('Recorte personalizado guardado.', 'success', 1800);
  }, [addToast, updateItem]);

  const getResolvedBlob = useCallback((item: ImageItem): Blob | null => {
    if (isItemDirectExport(item, settingsRef.current)) {
      return item.sourceFile;
    }
    if (item.status === 'completed' && !item.stale && item.resultBlob) {
      return item.resultBlob;
    }
    return null;
  }, []);

  type DownloadEntry = { item: ImageItem; blob: Blob };

  const collectDownloadEntries = useCallback((itemsToDownload: ImageItem[]): DownloadEntry[] | null => {
    if (itemsToDownload.length === 0) return null;
    const entries = itemsToDownload
      .map((item) => ({ item, blob: getResolvedBlob(item) }))
      .filter((entry): entry is DownloadEntry => !!entry.blob);
    return entries.length > 0 ? entries : null;
  }, [getResolvedBlob]);

  const writeEntriesToFolder = useCallback(async (entries: DownloadEntry[], folder: string) => {
    const nameMap = getExportNameMap();

    saveCancelledRef.current = false;
    setIsProcessing(true);
    setProcessingProgress({ current: 0, total: entries.length });
    setProcessingMessage('Guardando archivos en carpeta...');

    try {
      const namedEntries = entries.map((entry) => ({
        filename: nameMap.get(entry.item.id) || entry.item.originalName,
        blob: entry.blob,
      }));

      const result = await saveEntriesInChunks({
        entries: namedEntries,
        outputFolder: folder,
        saveFiles: (body) => api.imageOptimizerSaveFiles(body),
        shouldCancel: () => saveCancelledRef.current,
        onProgress: (current, total) => setProcessingProgress({ current, total }),
        encodeBuffer: arrayBufferToBase64,
      });

      const saved = result.saved_count;
      const skipped = result.skipped_count;
      if (result.cancelled) {
        if (saved === 0) {
          addToast('Guardado cancelado. No se escribio ningun archivo.', 'info', 4200);
        } else {
          addToast(
            `Guardado cancelado. ${saved} archivo(s) escritos antes de detener.${skipped > 0 ? ` ${skipped} omitido(s).` : ''} Carpeta: ${folder}`,
            'info',
            5200,
          );
        }
      } else if (saved === 0) {
        addToast('No se pudo guardar ningun archivo en la carpeta.', 'error', 4200);
      } else if (skipped === 0) {
        addToast(`Guardados ${saved} archivo(s) en: ${folder}`, 'success', 4200);
      } else {
        addToast(`Guardados ${saved} archivo(s). ${skipped} omitido(s). Carpeta: ${folder}`, 'info', 5200);
      }
    } catch (error) {
      console.error('Save to folder failed', error);
      const message = error instanceof Error ? error.message : 'Error desconocido';
      addToast(`No se pudo guardar en la carpeta: ${message}.`, 'error', 4600);
    } finally {
      saveCancelledRef.current = false;
      setIsProcessing(false);
      setProcessingMessage('');
      setProcessingProgress({ current: 0, total: 0 });
    }
  }, [addToast, getExportNameMap]);

  const downloadItemsAsZip = useCallback(async (itemsToDownload: ImageItem[]) => {
    const entries = collectDownloadEntries(itemsToDownload);
    if (!entries) {
      addToast(
        itemsToDownload.length === 0
          ? 'No hay archivos listos para descargar en este alcance.'
          : 'Todavia no hay resultados descargables.',
        'info',
        2200,
      );
      return;
    }

    const nameMap = getExportNameMap();
    try {
      const zipFilename = buildZipFilename(settingsRef.current);
      const zipBlob = await createStoredZipBlob(
        entries.map((entry) => ({
          filename: nameMap.get(entry.item.id) || entry.item.originalName,
          blob: entry.blob,
        })),
        zipFilename,
      );
      downloadBlob(zipBlob, zipFilename);
      addToast(`ZIP generado con ${entries.length} archivo(s).`, 'success', 2400);
    } catch (error) {
      console.error('ZIP creation failed', error);
      const message = error instanceof Error ? error.message : 'Error desconocido';
      addToast(`No se pudo generar el ZIP: ${message}.`, 'error', 4200);
    }
  }, [addToast, collectDownloadEntries, getExportNameMap]);

  const downloadItems = useCallback(async (itemsToDownload: ImageItem[]) => {
    const entries = collectDownloadEntries(itemsToDownload);
    if (!entries) {
      addToast(
        itemsToDownload.length === 0
          ? 'No hay archivos listos para descargar en este alcance.'
          : 'Todavia no hay resultados descargables.',
        'info',
        2200,
      );
      return;
    }

    const nameMap = getExportNameMap();

    if (entries.length === 1) {
      const entry = entries[0];
      const filename = nameMap.get(entry.item.id) || entry.item.originalName;
      downloadBlob(entry.blob, filename);
      addToast('Descargando 1 archivo.', 'success', 2200);
      return;
    }

    await downloadItemsAsZip(itemsToDownload);
  }, [addToast, collectDownloadEntries, downloadItemsAsZip, getExportNameMap]);

  const downloadItemsIndividually = useCallback(async (itemsToDownload: ImageItem[]) => {
    const entries = collectDownloadEntries(itemsToDownload);
    if (!entries) {
      addToast(
        itemsToDownload.length === 0
          ? 'No hay archivos listos para descargar en este alcance.'
          : 'Todavia no hay resultados descargables.',
        'info',
        2200,
      );
      return;
    }

    const outputFolder = settingsRef.current.export.outputFolder.trim();
    if (!outputFolder) {
      addToast('Elige la carpeta de destino junto al boton Procesar antes de exportar individualmente.', 'info', 3600);
      return;
    }

    await writeEntriesToFolder(entries, outputFolder);
  }, [addToast, collectDownloadEntries, writeEntriesToFolder]);

  const handleDownloadSingle = useCallback(async (item: ImageItem) => {
    const entries = collectDownloadEntries([item]);
    if (!entries) {
      addToast('Todavia no hay resultados descargables.', 'info', 2200);
      return;
    }

    const outputFolder = settingsRef.current.export.outputFolder.trim();
    if (outputFolder) {
      await writeEntriesToFolder(entries, outputFolder);
      return;
    }

    await downloadItems([item]);
  }, [addToast, collectDownloadEntries, downloadItems, writeEntriesToFolder]);

  const handleProcessScope = useCallback(async (scope: 'all' | 'selected') => {
    const targets = getProcessableItems(itemsRef.current, settingsRef.current, scope);
    if (targets.length === 0) {
      await downloadItems(getDownloadableItems(itemsRef.current, settingsRef.current, scope));
      return;
    }

    setIsProcessing(true);
    setProcessingProgress({ current: 0, total: targets.length });

    // Marcar todos como procesando para evitar condition de carrera con UI reactiva
    commitItems((prev) => prev.map((item) => targets.some((t) => t.id === item.id) ? { ...item, status: 'processing', error: undefined } : item));

    // Esperar el sig frame para dibujar
    await new Promise((resolve) => setTimeout(resolve, 50));

    let completed = 0;

    const outcomes = await mapWithConcurrencyLimit(
      targets,
      resolveProcessConcurrency(),
      async (target) => {
        setProcessingMessage(`Procesando ${target.originalName}`);
        try {
          const latestItem = itemsRef.current.find((item) => item.id === target.id) || target;
          const artifact = await processImageItem(latestItem, settingsRef.current);
          const previewUrl = URL.createObjectURL(artifact.blob);
          commitItems((prev) => prev.map((item) => {
            if (item.id !== target.id) return item;
            if (item.resultPreview) URL.revokeObjectURL(item.resultPreview);
            return {
              ...item,
              resultBlob: artifact.blob,
              resultPreview: previewUrl,
              resultSize: artifact.blob.size,
              finalWidth: artifact.width,
              finalHeight: artifact.height,
              status: 'completed',
              error: undefined,
              stale: false,
              processedSignature: artifact.signature,
              processedAt: Date.now(),
            };
          }));
          return true;
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Error desconocido';
          commitItems((prev) => prev.map((item) => (item.id === target.id ? { ...item, status: 'error', error: message } : item)));
          return false;
        } finally {
          completed += 1;
          setProcessingProgress({ current: completed, total: targets.length });
        }
      },
    );

    const successCount = outcomes.filter(Boolean).length;

    setIsProcessing(false);
    setProcessingMessage('');

    // Save to history
    const errorCount = targets.length - successCount;
    const settingsJson = JSON.stringify(settingsRef.current);
    saveFeatureHistory(
      'image_optimizer',
      `Lote ${successCount + errorCount} imágenes`,
      {
        preset: activePresetId || 'custom',
        scope,
        successCount,
        errorCount,
        settings: settingsJson,
      },
      successCount,
    );

    addToast(`${successCount}/${targets.length} imagen(es) procesadas.`, successCount === targets.length ? 'success' : 'info', 2800);
  }, [addToast, commitItems, downloadItems, activePresetId]);

  const cropEditorItem = cropEditorItemId ? items.find((item) => item.id === cropEditorItemId) ?? null : null;
  const activeItemOutputName = activeItem ? downloadNameMap.get(activeItem.id) || activeItem.originalName : '';
  const activeItemDownloadable = activeItem ? !!getResolvedBlob(activeItem) : false;
  const activeIsDirect = activeItem ? isItemDirectExport(activeItem, settings) : false;

  const toolbarBtn =
    'inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[10px] font-medium transition-[color,background-color,opacity,transform] duration-100 ease-out active:scale-[0.96] motion-reduce:active:scale-100 disabled:cursor-not-allowed disabled:opacity-40';

  return (
    <div
      ref={rootRef}
      className={`relative flex h-full flex-col overflow-hidden bg-[var(--bg-base)] px-1.5 py-1.5 text-[var(--text-primary)] antialiased transition-[box-shadow] duration-150 ${
        isDragActive ? 'shadow-[inset_0_0_0_2px_var(--accent-blue)]' : ''
      }`}
      onDragEnter={handleDrag}
      onDragLeave={handleDrag}
      onDragOver={handleDrag}
      onDrop={handleDrop}
    >
      <ToastContainer toasts={toasts} removeToast={removeToast} />
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/jpeg,image/png,image/webp,image/avif,image/bmp,.jpg,.jpeg,.png,.webp,.avif,.bmp"
        className="hidden"
        onChange={handleFileInput}
      />

      <div className="flex h-full w-full flex-col gap-2 overflow-hidden">
        <section className={`relative shrink-0 overflow-hidden px-2.5 py-1.5 ${glassToolbarClass}`}>
          <div className="flex flex-wrap items-center gap-2 xl:flex-nowrap">
            <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto no-scrollbar">
              {IMAGE_OPTIMIZER_PRESETS.map((preset) => (
                <PillPreset
                  key={preset.id}
                  label={preset.label}
                  accentClassName={preset.accentClassName}
                  active={activePresetId === preset.id}
                  onClick={() => handleApplyGlobalPreset(preset.id as PresetId)}
                />
              ))}
            </div>

            <div className="flex w-full flex-wrap items-center justify-end gap-1.5 xl:w-auto xl:flex-nowrap">
              <div className="flex flex-wrap items-center gap-1">
                <button
                  type="button"
                  aria-label="Elegir carpeta de destino"
                  onClick={handlePickOutputFolder}
                  disabled={isProcessing}
                  className={`${toolbarBtn} max-w-[min(11rem,100%)] border border-[var(--border-medium)] bg-[var(--bg-input)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]`}
                >
                  <FolderOpen size={12} className="shrink-0" />
                  <span className="truncate">{outputFolderLabel}</span>
                  {!settings.export.outputFolder.trim() && (
                    <AlertCircle size={11} className="shrink-0 text-[var(--accent-yellow)]" />
                  )}
                </button>
              </div>

              <div className="mx-0.5 hidden h-4 w-px bg-[var(--border-medium)] xl:block" aria-hidden="true" />

              <div className="flex flex-wrap items-center gap-1">
                <button
                  onClick={() => handleProcessScope(activeScope)}
                  disabled={isProcessing || stats.includedCount === 0}
                  className={`${toolbarBtn} bg-[var(--text-primary)] text-[var(--bg-base)] hover:opacity-90 disabled:opacity-30`}
                >
                  {isProcessing ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                  {primaryActionLabel}
                </button>
                <div
                  ref={downloadMenuAnchorRef}
                  className={`relative flex h-7 items-stretch overflow-hidden rounded-full border ${downloadableItems.length > 0 && !isProcessing
                    ? 'border-[var(--accent-green)]/40 bg-[var(--accent-green)]/12'
                    : 'border-[var(--border-medium)] bg-[var(--bg-input)]'
                    }`}
                >
                  <button
                    type="button"
                    onClick={() => { downloadItems(downloadableItems); closeDownloadMenu(); }}
                    disabled={isProcessing || downloadableItems.length === 0}
                    className={`inline-flex h-full items-center gap-1.5 px-2.5 text-[10px] font-medium transition-[opacity,transform] duration-100 active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-40 ${downloadableItems.length > 0 && !isProcessing ? 'text-[var(--accent-green)]' : 'text-[var(--text-secondary)]'}`}
                  >
                    <FileDown size={12} />
                    {downloadableItems.length > 1 ? 'ZIP' : 'Descargar'}
                  </button>
                  {downloadableItems.length > 0 && (
                    <button
                      type="button"
                      onClick={toggleDownloadMenu}
                      disabled={isProcessing || downloadableItems.length === 0}
                      aria-expanded={downloadMenuOpen}
                      aria-haspopup="menu"
                      aria-label="Opciones de descarga"
                      className="inline-flex h-full items-center border-l border-[var(--accent-green)]/30 px-1.5 text-[var(--accent-green)] transition-transform duration-100 active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <ChevronDown size={11} className={`transition-transform duration-100 ${downloadMenuOpen ? 'rotate-180' : ''}`} />
                    </button>
                  )}
                </div>
                {downloadMenuOpen && downloadMenuPosition && createPortal(
                  <>
                    <div className="fixed inset-0 z-[120]" onClick={closeDownloadMenu} aria-hidden="true" />
                    <div
                      role="menu"
                      style={{ top: downloadMenuPosition.top, right: downloadMenuPosition.right }}
                      className="fixed z-[130] w-52 overflow-hidden rounded-xl border border-[var(--border-medium)] bg-[var(--bg-elevated)] py-0.5 shadow-lg"
                    >
                      {downloadableItems.length > 1 && (
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => { downloadItemsAsZip(downloadableItems); closeDownloadMenu(); }}
                          className="flex h-8 w-full items-center gap-2 px-3 text-left text-[11px] text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-input)]"
                        >
                          <FileDown size={12} className="shrink-0 text-[var(--accent-green)]" />
                          Descargar como ZIP
                          <span className="ml-auto font-mono text-[9px] tabular-nums text-[var(--text-secondary)]">{downloadableItems.length}</span>
                        </button>
                      )}
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => { downloadItemsIndividually(downloadableItems); closeDownloadMenu(); }}
                        className="flex h-8 w-full items-center gap-2 px-3 text-left text-[11px] text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-input)]"
                      >
                        <FileDown size={12} className="shrink-0 text-sky-500" />
                        Descargar individual a carpeta
                        <span className="ml-auto font-mono text-[9px] tabular-nums text-[var(--text-secondary)]">{downloadableItems.length}</span>
                      </button>
                    </div>
                  </>,
                  document.body,
                )}
                <button
                  onClick={handleClearAll}
                  disabled={isProcessing || items.length === 0}
                  className={`${toolbarBtn} border border-[var(--border-medium)] bg-[var(--bg-input)] text-[var(--text-secondary)] hover:border-[var(--accent-red)]/40 hover:text-[var(--accent-red)] disabled:opacity-30`}
                >
                  <Trash2 size={12} />
                  Limpiar
                </button>
              </div>
            </div>
          </div>
        </section>

        <div className="grid min-h-0 flex-1 gap-2 pb-1 xl:grid-cols-[220px_minmax(0,1fr)_260px]">
          <SettingsPanel
            settings={settings}
            previewNames={previewNames}
            activeItem={activeItem}
            renameOnlyMode={activePresetId === 'rename-only'}
            onUpdateSettings={updateSettings}
            onOpenCropEditor={handleOpenCropEditor}
          />

          <PreviewWorkspace
            items={items}
            downloadNameMap={downloadNameMap}
            activeItem={activeItem}
            activeItemSettings={activeItemSettings}
            activeItemOutputName={activeItemOutputName}
            activeItemDownloadable={activeItemDownloadable}
            activeIsDirect={activeIsDirect}
            activeCropPreview={activeCropPreview}
            previewTab={previewTab}
            processing={isProcessing}
            processingProgress={processingProgress}
            processingMessage={processingMessage}
            primaryActionLabel={primaryActionLabel}
            viewMode={viewMode}
            onChangePreviewTab={setPreviewTab}
            onViewModeChange={setViewMode}
            onSetActiveItem={setActiveItemId}
            onDownloadSingle={handleDownloadSingle}
            onRemoveItem={handleRemoveItem}
            onOpenCropEditor={handleOpenCropEditor}
            onUpdateCustomFilename={handleUpdateCustomFilename}
            onUpdatePresetOverride={handleUpdatePresetOverride}
            onToggleSkipCompression={handleToggleSkipCompression}
            onToggleExcluded={handleToggleExcluded}
            onClearPresetOverride={handleClearPresetOverride}
            onAddClick={() => fileInputRef.current?.click()}
            isDragActive={isDragActive}
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
          />

          <QueuePanel
            items={items}
            settings={settings}
            activeItemId={activeItemId}
            selectedCount={selectedCount}
            includedCount={stats.includedCount}
            downloadableItems={downloadableItems}
            onSelectAll={handleSelectAll}
            onClearSelection={handleClearSelection}
            onApplyPresetToSelection={handleApplyPresetToSelection}
            onReprocessSelected={handleReprocessSelected}
            onToggleExcludeSelected={handleToggleExcludeSelected}
            onRemoveSelected={handleRemoveSelected}
            onToggleSelection={handleToggleSelection}
            onSetActiveItem={setActiveItemId}
            onOpenCropEditor={setCropEditorItemId}
            onDownloadSingle={handleDownloadSingle}
            onRemoveItem={handleRemoveItem}
            onReorderItems={handleReorderItems}
            getResolvedBlob={getResolvedBlob}
          />
        </div>
      </div>

      {
        cropEditorItem ? (
          <CropEditor
            image={cropEditorItem}
            aspectRatio={resolveSettingsForItem(settings, cropEditorItem).crop.aspectRatio}
            cropOrigin={resolveSettingsForItem(settings, cropEditorItem).crop.cropOrigin}
            onClose={() => setCropEditorItemId(null)}
            onSave={handleSaveCropOffset}
          />
        ) : null
      }

      {
        isProcessing ? (
          <div className="fixed bottom-5 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-full border border-[var(--border-medium)] bg-[var(--bg-elevated)] px-3 py-1.5 text-[12px] tabular-nums text-[var(--text-primary)] shadow-lg">
            <Loader2 size={14} className="animate-spin text-[var(--accent-primary)]" />
            {processingMessage || `Procesando ${processableItems.length} imagen(es)`}
          </div>
        ) : null
      }
    </div>
  );
}
