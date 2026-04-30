import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FileDown, Loader2, Sparkles, Trash2, Upload } from 'lucide-react';
import CropEditor from './CropEditor';
import PreviewWorkspace from './PreviewWorkspace';
import QueuePanel from './QueuePanel';
import SettingsPanel from './SettingsPanel';
import { PillPreset, ToastContainer } from './ui';
import { createImageItem, processImageItem } from './pipeline';
import { DEFAULT_BATCH_SETTINGS, IMAGE_OPTIMIZER_PRESETS, cloneBatchSettings } from './presets';
import { BatchSettings, CropOffset, ImageItem, PresetId, Toast } from './types';
import {
  buildDownloadNameMap,
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
  revokeItemUrls,
  syncStaleState,
  downloadBlob,
} from './utils';
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const itemsRef = useRef<ImageItem[]>([]);
  const settingsRef = useRef<BatchSettings>(settings);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

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
    const draft = cloneBatchSettings(settingsRef.current);
    updater(draft);
    commitSettings(draft, null);
  }, [commitSettings]);

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

  const processInputFiles = useCallback(async (inputFiles: FileList | File[] | null) => {
    if (!inputFiles || inputFiles.length === 0) return;
    const fileArray = Array.from(inputFiles);
    const validFiles = fileArray.filter((file) => file.type.startsWith('image/') && !file.type.includes('gif'));
    const ignored = fileArray.length - validFiles.length;
    if (ignored > 0) {
      addToast(`${ignored} archivo(s) ignorado(s). Solo JPG, PNG y WEBP.`, 'error', 4500);
    }
    if (validFiles.length === 0) return;

    const createdItems = await Promise.all(validFiles.map((file) => createImageItem(file)));
    commitItems((prev) => [...prev, ...createdItems]);
    setActiveItemId((current) => current || createdItems[0]?.id || null);
    addToast(`${createdItems.length} imagen(es) agregada(s) al lote.`, 'success', 2200);
  }, [addToast, commitItems]);

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setIsDragActive(true);
    } else if (e.type === 'dragleave') {
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
  const downloadNameMap = useMemo(() => buildDownloadNameMap(getEligibleItems(items), settings), [items, settings]);
  const previewNames = useMemo(() => previewFilenames(settings, items.length), [items.length, settings]);
  const primaryActionLabel = useMemo(() => getPrimaryActionLabel(scopedItems, settings), [scopedItems, settings]);

  const handleApplyGlobalPreset = useCallback((presetId: PresetId) => {
    const preset = IMAGE_OPTIMIZER_PRESETS.find((item) => item.id === presetId);
    if (!preset) return;
    commitSettings(cloneBatchSettings(preset.settings), presetId);
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

  const downloadItems = useCallback(async (itemsToDownload: ImageItem[]) => {
    if (itemsToDownload.length === 0) {
      addToast('No hay archivos listos para descargar en este alcance.', 'info', 2200);
      return;
    }
    const entries = itemsToDownload
      .map((item) => ({ item, blob: getResolvedBlob(item) }))
      .filter((entry): entry is { item: ImageItem; blob: Blob } => !!entry.blob);
    if (entries.length === 0) {
      addToast('Todavia no hay resultados descargables.', 'info', 2200);
      return;
    }

    const nameMap = buildDownloadNameMap(entries.map((entry) => entry.item), settingsRef.current);

    if (settingsRef.current.export.mode === 'individual' || entries.length === 1) {
      entries.forEach((entry, index) => {
        const filename = nameMap.get(entry.item.id) || entry.item.originalName;
        window.setTimeout(() => downloadBlob(entry.blob, filename), index * 120);
      });
      addToast(`Descargando ${entries.length} archivo(s).`, 'success', 2200);
      return;
    }

    // Backend ZIP creation via IPC
    try {
      const filesBase64 = await Promise.all(
        entries.map(async (entry) => {
          const arrayBuffer = await entry.blob.arrayBuffer();
          const bytes = new Uint8Array(arrayBuffer);
          let binary = '';
          for (let i = 0; i < bytes.length; i += 65536) {
            binary += String.fromCharCode(...bytes.subarray(i, i + 65536));
          }
          return {
            filename: nameMap.get(entry.item.id) || entry.item.originalName,
            content_b64: btoa(binary),
          };
        })
      );

      const res = await api.imageOptimizerZip({
        files: filesBase64,
        zip_name: buildZipFilename(settingsRef.current),
      });

      const binary = Uint8Array.from(atob(res.zip_base64), (c) => c.charCodeAt(0));
      const zipBlob = new Blob([binary], { type: 'application/zip' });
      downloadBlob(zipBlob, res.filename);
      addToast(`ZIP generado con ${entries.length} archivo(s).`, 'success', 2400);
    } catch (error) {
      console.error('ZIP creation failed', error);
      // Fallback to individual downloads
      entries.forEach((entry, index) => {
        const filename = nameMap.get(entry.item.id) || entry.item.originalName;
        window.setTimeout(() => downloadBlob(entry.blob, filename), index * 120);
      });
      const message = error instanceof Error ? error.message : 'Error desconocido';
      addToast(`Fallo el ZIP (${message}); se descargaron individualmente.`, 'error', 3800);
    }
  }, [addToast, getResolvedBlob]);

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

    let successCount = 0;

    for (let index = 0; index < targets.length; index += 1) {
      const target = targets[index];
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
        successCount += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Error desconocido';
        commitItems((prev) => prev.map((item) => item.id === target.id ? { ...item, status: 'error', error: message } : item));
      }

      setProcessingProgress({ current: index + 1, total: targets.length });
    }

    setIsProcessing(false);
    setProcessingMessage('');
    addToast(`${successCount}/${targets.length} imagen(es) procesadas.`, successCount === targets.length ? 'success' : 'info', 2800);
  }, [addToast, commitItems, downloadItems]);

  const cropEditorItem = cropEditorItemId ? items.find((item) => item.id === cropEditorItemId) ?? null : null;
  const activeItemOutputName = activeItem ? downloadNameMap.get(activeItem.id) || activeItem.originalName : '';
  const activeItemDownloadable = activeItem ? !!getResolvedBlob(activeItem) : false;
  const activeIsDirect = activeItem ? isItemDirectExport(activeItem, settings) : false;

  return (
    <div className="flex h-full flex-col px-2 py-2 text-[var(--text-primary)] overflow-hidden bg-[var(--bg-base)]">
      <ToastContainer toasts={toasts} removeToast={removeToast} />

      <div className="flex h-full w-full flex-col gap-3 overflow-hidden">
        <section className="relative shrink-0 overflow-hidden rounded-[14px] border border-[var(--border-medium)] bg-[var(--bg-surface)] px-5 py-3 shadow-sm">
          <div className="flex flex-wrap items-center gap-3 xl:flex-nowrap">
            <div className="flex min-w-0 flex-1 items-center gap-4 overflow-hidden">
              <h1 className="shrink-0 text-2xl uppercase tracking-[0.16em] text-[var(--text-primary)]" style={{ fontFamily: 'Inter, sans-serif' }}>Image Optimizer</h1>
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
            </div>
            <div className="flex w-full flex-wrap items-center justify-end gap-2 xl:w-auto xl:flex-nowrap">
              <button
                onClick={() => handleProcessScope(activeScope)}
                disabled={isProcessing || stats.includedCount === 0}
                className="inline-flex items-center gap-2 rounded-full border border-[var(--border-medium)] bg-[var(--text-primary)] px-4 py-2 text-[10px] font-mono uppercase tracking-[0.15em] text-[var(--bg-base)] transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-30"
              >
                {isProcessing ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                {primaryActionLabel}
              </button>
              <button
                onClick={() => downloadItems(downloadableItems)}
                disabled={isProcessing || downloadableItems.length === 0}
                className="inline-flex items-center gap-2 rounded-full border border-emerald-500/35 bg-emerald-500/10 px-4 py-2 text-[10px] font-mono uppercase tracking-[0.15em] text-emerald-600 transition-colors hover:border-emerald-500/55 hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:border-[var(--border-medium)] disabled:bg-[var(--bg-surface)] disabled:text-[var(--text-muted)]"
              >
                <FileDown size={13} />
                Descargar
              </button>
              <button
                onClick={handleClearAll}
                disabled={isProcessing || items.length === 0}
                className="inline-flex items-center gap-2 rounded-full border border-[var(--border-medium)] px-4 py-2 text-[10px] font-mono uppercase tracking-[0.15em] text-[var(--text-muted)] transition-colors hover:border-red-500/30 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-30"
              >
                <Trash2 size={13} />
                Limpiar
              </button>
              <div
                className={`group relative flex min-w-[12rem] cursor-pointer items-center gap-2 rounded-full border px-4 py-2 transition-colors duration-200 ${isDragActive
                  ? 'border-[var(--accent-primary)]/40 bg-[var(--accent-primary)]/8'
                  : 'border-dashed border-[var(--border-medium)] bg-[var(--bg-surface)] hover:border-[var(--text-muted)] hover:bg-[var(--bg-elevated)]'
                  }`}
                onDragEnter={handleDrag}
                onDragLeave={handleDrag}
                onDragOver={handleDrag}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    fileInputRef.current?.click();
                  }
                }}
              >
                <input ref={fileInputRef} type="file" multiple accept="image/jpeg,image/png,image/webp" onChange={handleFileInput} className="hidden" />
                <Upload size={12} className={`shrink-0 transition-colors ${isDragActive ? 'text-[var(--accent-primary)]' : 'text-[var(--text-muted)] group-hover:text-[var(--text-primary)]'}`} />
                <span className="flex-1 text-[10px] font-mono uppercase tracking-widest text-[var(--text-muted)] transition-colors group-hover:text-[var(--text-primary)]">
                  {isDragActive ? 'Suelta aqui' : 'Agregar imagenes'}
                </span>
                <span className="hidden text-[9px] font-mono tracking-wider text-[var(--text-muted)] opacity-50 sm:inline">JPG · PNG · WEBP</span>
              </div>

            </div>
          </div>
        </section>

        <div className="grid flex-1 min-h-0 gap-3 pb-2 xl:grid-cols-[240px_minmax(0,1fr)_280px]">
          <SettingsPanel
            settings={settings}
            previewNames={previewNames}
            activeItem={activeItem}
            renameOnlyMode={false}
            onUpdateSettings={updateSettings}
            onOpenCropEditor={(id?: string) => {
              const targetId = id ?? activeItem?.id;
              if (targetId) setCropEditorItemId(targetId);
            }}
          />

          <PreviewWorkspace
            items={items}
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
            onDownloadSingle={(item) => downloadItems([item])}
            onRemoveItem={handleRemoveItem}
            onOpenCropEditor={(id?: string) => {
              const targetId = id ?? activeItem?.id;
              if (targetId) setCropEditorItemId(targetId);
            }}
            onUpdateCustomFilename={(id, value) => updateItem(id, (item) => ({ ...item, overrides: { ...item.overrides, customFilename: value } }))}
            onUpdatePresetOverride={(id, value) => updateItem(id, (item) => ({ ...item, overrides: { ...item.overrides, presetId: value } }))}
            onToggleSkipCompression={(id, value) => updateItem(id, (item) => ({ ...item, overrides: { ...item.overrides, skipCompression: value } }))}
            onToggleExcluded={(id, value) => updateItem(id, (item) => ({ ...item, excluded: value, overrides: { ...item.overrides, excluded: value } }))}
            onClearPresetOverride={(id) => updateItem(id, (item) => ({ ...item, overrides: { ...item.overrides, presetId: null } }))}
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
            onToggleSelection={(id) => updateItem(id, (item) => ({ ...item, selected: !item.selected }))}
            onSetActiveItem={setActiveItemId}
            onOpenCropEditor={setCropEditorItemId}
            onDownloadSingle={(item) => downloadItems([item])}
            onRemoveItem={handleRemoveItem}
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
          <div className="fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-full border border-[var(--border-medium)] bg-[var(--bg-surface)]/95 px-4 py-2 text-sm font-mono text-[var(--text-primary)] shadow-2xl backdrop-blur">
            <Loader2 size={16} className="animate-spin" />
            {processingMessage || `Procesando ${processableItems.length} imagen(es)`}
          </div>
        ) : null
      }
    </div>
  );
}
