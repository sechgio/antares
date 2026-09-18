import React, { useState, useCallback } from 'react';
import {
  Upload,
  Folder,
  MapPin,
  Loader2,
  FileSpreadsheet,
  CheckCircle2,
  X,
  Files,
  FileOutput,
  PenTool,
} from 'lucide-react';
import Button from './ui/Button';
import { SegmentedControl } from './ui/SegmentedControl';
import { api } from '../api';
import { useToast } from '../hooks/useToast';
import { useLocalStorageState } from '../hooks/useLocalStorageState';
import { stageFileForIpc } from '../utils/stageFile';
import { parseCombinedCoords, isValidCoord } from '../utils/coords';
import { DesignPanel } from './ubicaciones/DesignPanel';
import { ManualEntryForm } from './ubicaciones/ManualEntryForm';
import { EmptyPreviewPanel, RealPreviewPanel, ResultPanel } from './ubicaciones/PreviewPanels';
import { useUbicacionesApiKeys } from './ubicaciones/useUbicacionesApiKeys';
import { useUbicacionesPreview } from './ubicaciones/useUbicacionesPreview';
import {
  DEFAULT_MANUAL_DATA,
  DEFAULT_STYLES,
  LS_FORMATO,
  LS_INPUT_MODE,
  LS_MANUAL_DATA,
  LS_OUTPUT_DIR,
  LS_OUTPUT_MODE,
  LS_PROVIDER,
  LS_ZOOM,
  STORAGE_KEY,
  deepMergeStyles,
  loadCustomStylesFromStorage,
  type CustomStyles,
  type ManualData,
  type OutputMode,
  type Result,
} from './ubicaciones/ubicacionesTypes';

export { ResultPanel, loadCustomStylesFromStorage };

export const UbicacionesView: React.FC = () => {
  const { addToast } = useToast();
  const [inputMode, setInputMode] = useLocalStorageState<'excel' | 'manual'>(LS_INPUT_MODE, {
    parse: (s) => (s === 'manual' ? 'manual' : 'excel'),
    fallback: 'excel',
    serialize: (v) => v,
  });
  const [manualData, setManualData] = useLocalStorageState<ManualData>(LS_MANUAL_DATA, {
    parse: (s) => ({ ...DEFAULT_MANUAL_DATA, ...JSON.parse(s) }),
    fallback: { ...DEFAULT_MANUAL_DATA },
  });

  const [excelFile, setExcelFile] = useState<File | null>(null);
  const [outputDir, setOutputDir] = useLocalStorageState<string>(LS_OUTPUT_DIR, {
    parse: (s) => s,
    fallback: '',
    serialize: (v) => v || null,
  });
  const [formato, setFormato] = useLocalStorageState<'vertical' | 'horizontal'>(LS_FORMATO, {
    parse: (s) => (s === 'horizontal' ? 'horizontal' : 'vertical'),
    fallback: 'vertical',
    serialize: (v) => v,
  });
  const [outputMode, setOutputMode] = useLocalStorageState<OutputMode>(LS_OUTPUT_MODE, {
    parse: (s) => (s === 'consolidado' ? 'consolidado' : 'individual'),
    fallback: 'individual',
    serialize: (v) => v,
  });
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState<Result>(null);
  const [isDragging, setIsDragging] = useState(false);

  const [excelPath, setExcelPath] = useState<string>('');

  const [zoom, setZoom] = useLocalStorageState<number>(LS_ZOOM, {
    parse: (s) => (s ? parseInt(s, 10) : 18),
    fallback: 18,
    serialize: (v) => v.toString(),
  });

  const [provider, setProvider] = useLocalStorageState<string>(LS_PROVIDER, {
    parse: (s) => s || 'osm',
    fallback: 'osm',
    serialize: (v) => v,
  });

  const { apiKeys, setApiKeys, keysConfigured } = useUbicacionesApiKeys();

  const [customStyles, setCustomStyles] = useLocalStorageState<CustomStyles>(STORAGE_KEY, {
    parse: (s) => deepMergeStyles(DEFAULT_STYLES, JSON.parse(s)),
    fallback: DEFAULT_STYLES,
  });

  const {
    state: { preview, previewLoading, previewError, previewRowIndex, totalFilas },
    actions: {
      setPreviewRowIndex,
      setTotalFilas,
      setPreviewLoading,
      syncParams,
      triggerPreviewFetch,
      schedulePreview,
      scheduleTextPreview,
      scheduleMapPreview,
      scheduleStylePreview,
      scheduleMapRefetch,
      clearPreview,
      resetPreview,
      invalidateFetches,
    },
    refs: { excelFileRef, lastParamsRef, prevFormatoRef },
  } = useUbicacionesPreview({
    excelPath,
    inputMode,
    manualData,
    formato,
    outputDir,
    outputMode,
    customStyles,
    provider,
    zoom,
    apiKeys,
  });

  const lonInputRef = React.useRef<HTMLInputElement>(null);

  const updateStyle = useCallback(
    (updater: (prev: CustomStyles) => CustomStyles) => {
      setCustomStyles((prev) => {
        const next = updater(prev);
        syncParams({ customStyles: next });
        scheduleStylePreview();
        return next;
      });
    },
    [setCustomStyles, syncParams, scheduleStylePreview],
  );

  const updateZoom = useCallback((newZoom: number) => {
    setZoom(newZoom);
    syncParams({ zoom: newZoom });
    scheduleMapRefetch(100);
  }, [setZoom, syncParams, scheduleMapRefetch]);

  const updateProvider = useCallback((newProvider: string) => {
    setProvider(newProvider);
    syncParams({ provider: newProvider });
    if (excelPath || inputMode === 'manual') {
      scheduleMapRefetch(50);
    }
  }, [setProvider, syncParams, excelPath, inputMode, scheduleMapRefetch]);

  const handleApiKeyChange = useCallback((providerId: string, value: string) => {
    setApiKeys((prev) => {
      const next = { ...prev, [providerId]: value };
      syncParams({ apiKeys: next });
      return next;
    });
    scheduleMapRefetch(300);
  }, [setApiKeys, syncParams, scheduleMapRefetch]);

  const resetStyles = useCallback(() => {
    setCustomStyles(DEFAULT_STYLES);
    syncParams({ customStyles: DEFAULT_STYLES });
    scheduleStylePreview();
  }, [setCustomStyles, syncParams, scheduleStylePreview]);

  const loadExcelFile = useCallback(
    async (file: File) => {
      const token = await stageFileForIpc(file);
      if (!token) {
        setExcelFile(null);
        setExcelPath('');
        resetPreview();
        addToast({
          message: 'No se pudo preparar el archivo Excel.',
          type: 'error',
        });
        return;
      }
      excelFileRef.current = file;
      setExcelFile(file);
      setResult(null);
      clearPreview();
      setPreviewRowIndex(0);
      prevFormatoRef.current = formato;
      setExcelPath(token);
      setPreviewLoading(true);
      triggerPreviewFetch(0, { excelPathOverride: token });
    },
    [triggerPreviewFetch, formato, addToast, resetPreview, clearPreview, setPreviewRowIndex, setPreviewLoading, excelFileRef, prevFormatoRef],
  );

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      loadExcelFile(e.target.files[0]);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file && /\.(xlsx|xls)$/i.test(file.name)) {
      loadExcelFile(file);
    }
  };

  const handleRemoveExcel = () => {
    invalidateFetches();
    excelFileRef.current = null;
    setExcelFile(null);
    setExcelPath('');
    resetPreview();
    setResult(null);
    setPreviewRowIndex(0);
    setTotalFilas(0);
  };

  const handleSelectOutputDir = async () => {
    try {
      const result = await api.dialogFolder({
        title: 'Seleccionar carpeta de salida',
        pickOnly: true,
      });
      if (result.folder) {
        setOutputDir(result.folder);
      } else if (result.paths && result.paths.length > 0) {
        setOutputDir(result.paths[0]);
      }
    } catch (err) {
      console.error('Error selecting directory:', err);
    }
  };

  const handleGenerate = async () => {
    if (inputMode === 'excel' && !excelFile) return;
    if (inputMode === 'manual' && (!manualData.lat || !manualData.lon)) {
      setResult({ success: false, error: 'Ingresa latitud y longitud válidas' });
      return;
    }
    if (!outputDir) return;

    setIsProcessing(true);
    setResult(null);

    try {
      if (!window.electronAPI) {
        setResult({ success: false, error: 'API de Antares no disponible.' });
        return;
      }

      let path = '';
      if (inputMode === 'excel' && excelFile) {
        path = (await stageFileForIpc(excelFile)) || '';
        if (!path) {
          setResult({ success: false, error: 'No se pudo preparar el archivo Excel.' });
          return;
        }
      }

      const {
        inputMode: genInputMode,
        manualData: genManualData,
        formato: genFormato,
        outputDir: genOutputDir,
        outputMode: genOutputMode,
        customStyles: genStyles,
        provider: genProvider,
        zoom: genZoom,
        apiKeys: genApiKeys,
      } = lastParamsRef.current;

      const response = await api.generarUbicaciones({
        excelPath: genInputMode === 'excel' ? path : null,
        outputDir: genOutputDir,
        formato: genFormato,
        consolidado: genOutputMode === 'consolidado',
        customStyles: genStyles as Record<string, unknown>,
        provider: genProvider,
        zoom: genZoom,
        api_key: genApiKeys[genProvider] || '',
        manualData: genInputMode === 'manual' ? genManualData : undefined,
      });
      setResult({ success: true, data: response });
    } catch (err: unknown) {
      setResult({ success: false, error: err instanceof Error ? err.message : 'Error desconocido' });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleManualChange = (field: keyof typeof manualData, value: string) => {
    setResult(null);
    if (field === 'lat') {
      const parsed = parseCombinedCoords(value);
      if (parsed) {
        setManualData((prev) => {
          const next = { ...prev, lat: parsed.lat, lon: parsed.lon };
          syncParams({ manualData: next });
          return next;
        });
        if (isValidCoord(parsed.lat) && isValidCoord(parsed.lon)) {
          scheduleMapPreview(true);
        } else {
          clearPreview();
        }
        lonInputRef.current?.focus();
        return;
      }
    }
    setManualData((prev) => {
      const next = { ...prev, [field]: value };
      syncParams({ manualData: next });
      return next;
    });
    const isCoordChange = field === 'lat' || field === 'lon';
    if (isCoordChange) {
      const nextLat = field === 'lat' ? value : manualData.lat;
      const nextLon = field === 'lon' ? value : manualData.lon;
      if (isValidCoord(nextLat) && isValidCoord(nextLon)) {
        scheduleMapPreview(false);
      } else {
        clearPreview();
      }
      return;
    }
    scheduleTextPreview();
  };

  const handlePrevRow = () => {
    if (previewRowIndex > 0) {
      const newIndex = previewRowIndex - 1;
      setPreviewRowIndex(newIndex);
      schedulePreview(newIndex);
    }
  };

  const handleNextRow = () => {
    if (totalFilas > 0 && previewRowIndex < totalFilas - 1) {
      const newIndex = previewRowIndex + 1;
      setPreviewRowIndex(newIndex);
      schedulePreview(newIndex);
    }
  };

  const hasValidManualCoords = isValidCoord(manualData.lat) && isValidCoord(manualData.lon);
  const canGenerate = (inputMode === 'excel' ? !!excelFile : hasValidManualCoords) && !!outputDir && !isProcessing;
  const folderName = outputDir ? outputDir.split('\\').pop() || outputDir.split('/').pop() : '';

  const hasData = inputMode === 'excel' ? !!excelFile : true;

  return (
    <div data-surface="ubicaciones" className="flex h-full overflow-hidden">
      <div data-surface-part="sidebar" className="w-[340px] flex flex-col border-r border-[var(--border-subtle)] bg-[var(--bg-base)] overflow-hidden">
        <div className="shrink-0 flex items-center gap-2.5 px-4 h-11 border-b border-[var(--border-subtle)]">
          <MapPin size={16} className="text-[var(--accent-primary)] shrink-0" />
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">Generador de Ubicaciones</h2>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          <div className="flex flex-col gap-3">

            <section className="flex flex-col gap-1.5">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Origen de Datos
              </label>
              <SegmentedControl
                value={inputMode}
                onChange={(v) => {
                  const nextMode = v as 'excel' | 'manual';
                  setInputMode(nextMode);
                  syncParams({ inputMode: nextMode });
                  setResult(null);
                  if (nextMode === 'excel' && excelPath) {
                    schedulePreview(previewRowIndex);
                  } else if (nextMode === 'manual') {
                    if (isValidCoord(manualData.lat) && isValidCoord(manualData.lon)) {
                      schedulePreview(0);
                    } else {
                      clearPreview();
                    }
                  }
                }}
                options={[
                  { value: 'excel', label: <><FileSpreadsheet size={12} /> Excel</> },
                  { value: 'manual', label: <><PenTool size={12} /> Manual</> },
                ]}
              />

              {inputMode === 'excel' ? (
                excelFile ? (
                  <div className="flex items-center gap-2 rounded-lg border border-[var(--accent-green)]/25 bg-[var(--accent-green)]/[0.06] px-3 py-2 transition-all mt-1">
                    <CheckCircle2 size={14} className="text-[var(--accent-green)] shrink-0" />
                    <span className="text-[11px] font-medium text-[var(--text-primary)] truncate flex-1">
                      {excelFile.name}
                    </span>
                    <span className="text-[10px] text-[var(--text-muted)] shrink-0">
                      {(excelFile.size / 1024).toFixed(0)} KB
                    </span>
                    <Button variant="none" size="none"
                      onClick={handleRemoveExcel}
                      aria-label="Quitar archivo Excel"
                      className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors shrink-0"
                    >
                      <X size={12} />
                    </Button>
                  </div>
                ) : (
                  <label
                    onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                    onDragLeave={() => setIsDragging(false)}
                    onDrop={handleDrop}
                    className={`group flex items-center gap-2.5 py-2 px-3 rounded-lg border-2 border-dashed transition-all duration-200 cursor-pointer mt-1 ${
                      isDragging
                        ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)]/[0.06] scale-[1.01]'
                        : 'border-[var(--border-medium)] hover:border-[var(--accent-primary)]/50 hover:bg-[var(--bg-elevated)]'
                    }`}
                  >
                    <FileSpreadsheet
                      size={16}
                      className={`shrink-0 transition-colors ${
                        isDragging
                          ? 'text-[var(--accent-primary)]'
                          : 'text-[var(--text-muted)] group-hover:text-[var(--accent-primary)]/80'
                      }`}
                    />
                    <div className="min-w-0">
                      <span className="text-[11px] font-medium text-[var(--text-secondary)] block leading-tight">
                        Arrastra o haz clic para subir
                      </span>
                      <span className="text-[10px] text-[var(--text-muted)] leading-tight">.xlsx, .xls</span>
                    </div>
                    <input type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFileChange} />
                  </label>
                )
              ) : (
                <ManualEntryForm
                  manualData={manualData}
                  onChange={handleManualChange}
                  lonInputRef={lonInputRef}
                />
              )}
            </section>

            <section className="flex flex-col gap-1.5">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Carpeta de Destino
              </label>
              <Button variant="none" size="none"
                onClick={handleSelectOutputDir}
                className={`flex items-center gap-2 w-full rounded-lg border px-3 py-2 text-left transition-all duration-200 ${
                  outputDir
                    ? 'border-[var(--accent-green)]/25 bg-[var(--accent-green)]/[0.06]'
                    : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:border-[var(--border-medium)] hover:bg-[var(--bg-elevated)]'
                }`}
              >
                <Folder
                  size={14}
                  className={`shrink-0 ${outputDir ? 'text-[var(--accent-green)]' : 'text-[var(--text-muted)]'}`}
                />
                <div className="flex flex-col min-w-0 flex-1">
                  <span
                    className={`text-[11px] font-medium truncate ${
                      outputDir ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'
                    }`}
                  >
                    {folderName || 'Seleccionar carpeta...'}
                  </span>
                  {outputDir && (
                    <span className="text-[9px] text-[var(--text-muted)] truncate">{outputDir}</span>
                  )}
                </div>
              </Button>
            </section>

            <section className="flex flex-col gap-2">
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  Orientación
                </label>
                <SegmentedControl
                  value={formato}
                  onChange={(v) => setFormato(v as 'vertical' | 'horizontal')}
                  options={[
                    { value: 'vertical', label: <>↕ Vertical</> },
                    { value: 'horizontal', label: <>↔ Horizontal</> },
                  ]}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  Modo de Salida
                </label>
                <SegmentedControl
                  value={outputMode}
                  onChange={(v) => setOutputMode(v as OutputMode)}
                  options={[
                    { value: 'individual', label: <><Files size={12} /> Individual</> },
                    { value: 'consolidado', label: <><FileOutput size={12} /> Consolidado</> },
                  ]}
                />
              </div>
            </section>

            <DesignPanel
              customStyles={customStyles}
              onUpdateStyle={updateStyle}
              provider={provider}
              onProviderChange={updateProvider}
              apiKeys={apiKeys}
              onApiKeyChange={handleApiKeyChange}
              keysConfigured={keysConfigured}
              zoom={zoom}
              onZoomChange={updateZoom}
              onResetStyles={resetStyles}
            />

          </div>
        </div>

        <div className="shrink-0 border-t border-[var(--border-subtle)] bg-[var(--bg-base)] px-4 py-2">
          <Button className="w-full" disabled={!canGenerate} onClick={handleGenerate}>
            {isProcessing ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Procesando...
              </>
            ) : (
              <>
                <Upload size={14} />
                {outputMode === 'consolidado' ? 'Generar PDF Consolidado' : 'Generar PDFs'}
              </>
            )}
          </Button>
        </div>
      </div>

      <div data-surface-part="workspace" className="flex-1 flex flex-col bg-[var(--bg-elevated)] overflow-hidden">
        {result ? (
          <ResultPanel result={result} outputDir={outputDir} />
        ) : hasData ? (
          <RealPreviewPanel
            preview={preview}
            loading={previewLoading}
            error={previewError}
            rowIndex={previewRowIndex}
            totalFilas={inputMode === 'excel' ? totalFilas : 1}
            isProcessing={isProcessing}
            onPrev={handlePrevRow}
            onNext={handleNextRow}
            onRefresh={() => triggerPreviewFetch(previewRowIndex)}
            inputMode={inputMode}
            manualData={manualData}
          />
        ) : (
          <EmptyPreviewPanel formato={formato} />
        )}
      </div>
    </div>
  );
};
