import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  Upload,
  Folder,
  MapPin,
  Loader2,
  FileSpreadsheet,
  CheckCircle2,
  X,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Eye,
  Files,
  FileOutput,
  Check,
} from 'lucide-react';
import Button from './ui/Button';
import { api } from '../api';

type Result = { success: boolean; data?: any; error?: string } | null;

type PreviewData = {
  image: string;
  cod_componente: string;
  direccion: string;
  localidad: string;
  distrito: string;
  total_filas: number;
  row_index: number;
  formato?: string;
} | null;

type OutputMode = 'individual' | 'consolidado';

// ──────────────────────────────────────────────
// Step Indicator Component
// ──────────────────────────────────────────────
const StepIndicator: React.FC<{
  number: number;
  completed: boolean;
  active: boolean;
  isLast?: boolean;
}> = ({ number, completed, active, isLast }) => (
  <div className="flex flex-col items-center shrink-0">
    <div
      className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold transition-all duration-300 ${
        completed
          ? 'bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/30'
          : active
            ? 'bg-[var(--accent-primary)]/15 text-[var(--accent-primary)] ring-1 ring-[var(--accent-primary)]/40'
            : 'bg-[var(--bg-input)] text-[var(--text-muted)] ring-1 ring-[var(--border-subtle)]'
      }`}
    >
      {completed ? <Check size={13} strokeWidth={3} /> : number}
    </div>
    {!isLast && (
      <div
        className={`w-px h-4 mt-1 transition-colors duration-300 ${
          completed ? 'bg-emerald-500/30' : 'bg-[var(--border-subtle)]'
        }`}
      />
    )}
  </div>
);

// ──────────────────────────────────────────────
// Orientation Preview Icon
// ──────────────────────────────────────────────
const OrientationIcon: React.FC<{ type: 'vertical' | 'horizontal'; active: boolean }> = ({
  type,
  active,
}) => {
  const w = type === 'vertical' ? 18 : 26;
  const h = type === 'vertical' ? 26 : 18;
  return (
    <div
      className={`rounded-[4px] border-2 transition-all duration-200 ${
        active
          ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)]/10'
          : 'border-[var(--text-muted)]/40 bg-transparent'
      }`}
      style={{ width: w, height: h }}
    >
      <div className="w-full h-full flex items-center justify-center">
        <MapPin
          size={type === 'vertical' ? 10 : 8}
          className={`transition-colors ${active ? 'text-[var(--accent-primary)]' : 'text-[var(--text-muted)]/60'}`}
        />
      </div>
    </div>
  );
};

export const UbicacionesView: React.FC = () => {
  const [excelFile, setExcelFile] = useState<File | null>(null);
  const [outputDir, setOutputDir] = useState<string>('');
  const [formato, setFormato] = useState<'vertical' | 'horizontal'>('vertical');
  const [outputMode, setOutputMode] = useState<OutputMode>('individual');
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState<Result>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Preview state
  const [preview, setPreview] = useState<PreviewData>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewRowIndex, setPreviewRowIndex] = useState(0);
  const [excelPath, setExcelPath] = useState<string>('');

  // Track the latest fetch request to avoid race conditions
  const fetchIdRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const fetchPreview = useCallback(
    async (
      rowIndex: number,
      options?: { recomposeOnly?: boolean; excelPathOverride?: string; softLoad?: boolean },
    ) => {
      const path = options?.excelPathOverride ?? excelPath;
      if (!path) return;
      const myId = ++fetchIdRef.current;
      const currentFormato = formato;
      const softLoad = options?.softLoad === true || options?.recomposeOnly === true;
      if (!softLoad) {
        setPreviewLoading(true);
      }
      setPreviewError(null);
      try {
        const resp = await api.previewUbicacion({
          excelPath: path,
          formato: currentFormato,
          rowIndex,
          recomposeOnly: options?.recomposeOnly === true,
        });
        // Ignore stale responses
        if (myId !== fetchIdRef.current) return;
        const r = resp as { success: boolean; data?: any; error?: string };
        if (r?.success) {
          // Defensive: if the response carries a formato field and it does
          // not match the current selection, skip it (stale format toggle).
          const respFormato = r.data?.formato;
          if (respFormato && respFormato !== formato) return;
          setPreview(r.data ?? null);
        } else {
          setPreviewError(r?.error || 'Error al generar vista previa');
        }
      } catch (err: any) {
        if (myId !== fetchIdRef.current) return;
        setPreviewError(err.message || 'Error de conexion');
      } finally {
        if (myId === fetchIdRef.current) {
          setPreviewLoading(false);
        }
      }
    },
    [excelPath, formato],
  );

  const prevFormatoRef = useRef(formato);

  // Solo re-fetch al cambiar orientación (la carga inicial la disparan los handlers)
  useEffect(() => {
    if (!excelPath) {
      setPreview(null);
      setPreviewError(null);
      return;
    }
    if (prevFormatoRef.current === formato) return;
    prevFormatoRef.current = formato;
    fetchPreview(previewRowIndex, { recomposeOnly: true, softLoad: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formato]);

  const loadExcelFile = useCallback(
    (file: File) => {
      setExcelFile(file);
      setResult(null);
      setPreview(null);
      setPreviewRowIndex(0);
      const path = window.electronAPI?.getPathForFile?.(file) || '';
      if (!path) return;
      prevFormatoRef.current = formato;
      setExcelPath(path);
      setPreviewLoading(true);
      fetchPreview(0, { excelPathOverride: path });
    },
    [fetchPreview, formato],
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
    // Cancel any in-flight preview request so stale responses don't update state
    fetchIdRef.current++;
    setExcelFile(null);
    setExcelPath('');
    setPreview(null);
    setPreviewError(null);
    setPreviewLoading(false);
    setResult(null);
    setPreviewRowIndex(0);
  };

  const handleSelectOutputDir = async () => {
    try {
      if (!window.electronAPI) return;
      const result = await window.electronAPI.invoke('dialog_folder', {
        title: 'Seleccionar carpeta de salida',
        pickOnly: true,
      }) as { folder?: string; paths?: string[] } | undefined;
      if (result?.folder) {
        setOutputDir(result.folder);
      } else if (result?.paths && result.paths.length > 0) {
        setOutputDir(result.paths[0]);
      }
    } catch (err) {
      console.error('Error selecting directory:', err);
    }
  };

  const handleGenerate = async () => {
    if (!excelFile || !outputDir) return;

    setIsProcessing(true);
    setResult(null);

    try {
      if (!window.electronAPI) {
        setResult({ success: false, error: 'API de Antares no disponible.' });
        return;
      }
      const path = window.electronAPI.getPathForFile?.(excelFile) || '';
      if (!path) {
        setResult({ success: false, error: 'No se pudo resolver la ruta del archivo Excel.' });
        return;
      }
      const response = await api.generarUbicaciones({
        excelPath: path,
        outputDir,
        formato,
        consolidado: outputMode === 'consolidado',
      });
      setResult(response);
    } catch (err: any) {
      setResult({ success: false, error: err.message || 'Error desconocido' });
    } finally {
      setIsProcessing(false);
    }
  };

  const schedulePreview = useCallback(
    (rowIndex: number) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        fetchPreview(rowIndex);
      }, 250);
    },
    [fetchPreview],
  );

  const handlePrevRow = () => {
    if (previewRowIndex > 0) {
      const newIndex = previewRowIndex - 1;
      setPreviewRowIndex(newIndex);
      schedulePreview(newIndex);
    }
  };

  const handleNextRow = () => {
    if (preview && previewRowIndex < preview.total_filas - 1) {
      const newIndex = previewRowIndex + 1;
      setPreviewRowIndex(newIndex);
      schedulePreview(newIndex);
    }
  };

  const canGenerate = excelFile && outputDir && !isProcessing;
  const folderName = outputDir ? outputDir.split('\\').pop() || outputDir.split('/').pop() : '';

  // Step completion states
  const step1Done = !!excelFile;
  const step2Done = !!outputDir;
  const step3Done = true; // always has a default
  const step4Done = true; // always has a default

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Sidebar: Config ── */}
      <div className="w-[380px] flex flex-col border-r border-[var(--border-subtle)] bg-[var(--bg-base)] overflow-hidden">
        {/* Title (fixed top) */}
        <div className="shrink-0 flex items-center gap-2.5 px-5 h-11 border-b border-[var(--border-subtle)]">
          <MapPin size={18} className="text-[var(--accent-primary)] shrink-0" />
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">Generador de Ubicaciones</h2>
        </div>

        {/* Scrollable config sections */}
        <div className="flex-1 overflow-y-auto px-5 py-5">
          <div className="flex flex-col gap-1">

            {/* ── Step 1: Excel File ── */}
            <div className="flex gap-3">
              <StepIndicator number={1} completed={step1Done} active={!step1Done} />
              <section className="flex-1 flex flex-col gap-2 pb-5">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  Archivo Excel
                </label>

                {excelFile ? (
                  <div className="flex items-center gap-2.5 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.06] px-3.5 py-3 transition-all">
                    <div className="w-8 h-8 rounded-lg bg-emerald-500/15 flex items-center justify-center shrink-0">
                      <CheckCircle2 size={16} className="text-emerald-400" />
                    </div>
                    <div className="flex flex-col flex-1 min-w-0">
                      <span className="text-xs font-medium text-[var(--text-primary)] truncate">
                        {excelFile.name}
                      </span>
                      <span className="text-[10px] text-[var(--text-muted)]">
                        {(excelFile.size / 1024).toFixed(1)} KB
                      </span>
                    </div>
                    <button
                      onClick={handleRemoveExcel}
                      aria-label="Quitar archivo Excel"
                      className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  <label
                    onDragOver={(e) => {
                      e.preventDefault();
                      setIsDragging(true);
                    }}
                    onDragLeave={() => setIsDragging(false)}
                    onDrop={handleDrop}
                    className={`group flex items-center gap-3 py-2.5 px-3.5 rounded-xl border-2 border-dashed transition-all duration-300 cursor-pointer ${
                      isDragging
                        ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)]/[0.08] scale-[1.01]'
                        : 'border-[var(--border-medium)] hover:border-[var(--accent-primary)]/60 hover:bg-[var(--bg-elevated)]'
                    }`}
                  >
                    <div
                      className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-all duration-300 ${
                        isDragging
                          ? 'bg-[var(--accent-primary)]/15 scale-110'
                          : 'bg-[var(--bg-input)] group-hover:bg-[var(--accent-primary)]/10'
                      }`}
                    >
                      <FileSpreadsheet
                        size={16}
                        className={`shrink-0 transition-colors duration-300 ${
                          isDragging
                            ? 'text-[var(--accent-primary)]'
                            : 'text-[var(--text-muted)] group-hover:text-[var(--accent-primary)]/80'
                        }`}
                      />
                    </div>
                    <div className="min-w-0">
                      <span className="text-xs font-medium text-[var(--text-secondary)] block leading-tight">
                        Arrastra o haz clic para subir
                      </span>
                      <span className="text-[10px] text-[var(--text-muted)] leading-tight">.xlsx, .xls</span>
                    </div>
                    <input type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFileChange} />
                  </label>
                )}
              </section>
            </div>

            {/* ── Step 2: Output Directory ── */}
            <div className="flex gap-3">
              <StepIndicator number={2} completed={step2Done} active={step1Done && !step2Done} />
              <section className="flex-1 flex flex-col gap-2 pb-5">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  Carpeta de Destino
                </label>
                <button
                  onClick={handleSelectOutputDir}
                  className={`flex items-center gap-2.5 w-full rounded-xl border px-3.5 py-3 text-left transition-all duration-200 ${
                    outputDir
                      ? 'border-emerald-500/25 bg-emerald-500/[0.06]'
                      : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:border-[var(--border-medium)] hover:bg-[var(--bg-elevated)]'
                  }`}
                >
                  <div
                    className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-colors ${
                      outputDir ? 'bg-emerald-500/15' : 'bg-[var(--bg-input)]'
                    }`}
                  >
                    <Folder
                      size={16}
                      className={`shrink-0 ${outputDir ? 'text-emerald-400' : 'text-[var(--text-muted)]'}`}
                    />
                  </div>
                  <div className="flex flex-col min-w-0 flex-1">
                    <span
                      className={`text-xs font-medium truncate ${
                        outputDir ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'
                      }`}
                    >
                      {folderName || 'Seleccionar carpeta'}
                    </span>
                    {outputDir && (
                      <span className="text-[10px] text-[var(--text-muted)] truncate">{outputDir}</span>
                    )}
                  </div>
                </button>
              </section>
            </div>

            {/* ── Step 3: Format ── */}
            <div className="flex gap-3">
              <StepIndicator number={3} completed={step3Done} active={step1Done && step2Done} />
              <section className="flex-1 flex flex-col gap-2 pb-5">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  Orientación del Mapa
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setFormato('vertical')}
                    className={`group flex items-center gap-2.5 rounded-xl border px-3 py-3 transition-all duration-200 ${
                      formato === 'vertical'
                        ? 'border-[var(--accent-primary)]/50 bg-[var(--accent-primary)]/[0.08] text-[var(--text-primary)]'
                        : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-muted)] hover:border-[var(--border-medium)] hover:text-[var(--text-secondary)]'
                    }`}
                  >
                    <OrientationIcon type="vertical" active={formato === 'vertical'} />
                    <span className="text-[11px] font-medium">Vertical</span>
                  </button>
                  <button
                    onClick={() => setFormato('horizontal')}
                    className={`group flex items-center gap-2.5 rounded-xl border px-3 py-3 transition-all duration-200 ${
                      formato === 'horizontal'
                        ? 'border-[var(--accent-primary)]/50 bg-[var(--accent-primary)]/[0.08] text-[var(--text-primary)]'
                        : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-muted)] hover:border-[var(--border-medium)] hover:text-[var(--text-secondary)]'
                    }`}
                  >
                    <OrientationIcon type="horizontal" active={formato === 'horizontal'} />
                    <span className="text-[11px] font-medium">Horizontal</span>
                  </button>
                </div>
              </section>
            </div>

            {/* ── Step 4: Output Mode ── */}
            <div className="flex gap-3">
              <StepIndicator number={4} completed={step4Done} active={step1Done && step2Done} isLast />
              <section className="flex-1 flex flex-col gap-2 pb-2">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  Modo de Salida
                </label>
                <div className="flex flex-col gap-2">
                  <button
                    onClick={() => setOutputMode('individual')}
                    className={`flex items-center gap-3 rounded-xl border px-3.5 py-3 transition-all duration-200 text-left ${
                      outputMode === 'individual'
                        ? 'border-[var(--accent-primary)]/50 bg-[var(--accent-primary)]/[0.08]'
                        : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:border-[var(--border-medium)]'
                    }`}
                  >
                    <div
                      className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-colors ${
                        outputMode === 'individual'
                          ? 'bg-[var(--accent-primary)]/15'
                          : 'bg-[var(--bg-input)]'
                      }`}
                    >
                      <Files
                        size={16}
                        className={
                          outputMode === 'individual'
                            ? 'text-[var(--accent-primary)]'
                            : 'text-[var(--text-muted)]'
                        }
                      />
                    </div>
                    <div className="flex flex-col min-w-0">
                      <span
                        className={`text-xs font-medium ${
                          outputMode === 'individual' ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'
                        }`}
                      >
                        PDFs Individuales
                      </span>
                      <span className="text-[10px] text-[var(--text-muted)] leading-tight">
                        Un archivo por ubicación
                      </span>
                    </div>
                  </button>
                  <button
                    onClick={() => setOutputMode('consolidado')}
                    className={`flex items-center gap-3 rounded-xl border px-3.5 py-3 transition-all duration-200 text-left ${
                      outputMode === 'consolidado'
                        ? 'border-[var(--accent-primary)]/50 bg-[var(--accent-primary)]/[0.08]'
                        : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:border-[var(--border-medium)]'
                    }`}
                  >
                    <div
                      className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-colors ${
                        outputMode === 'consolidado'
                          ? 'bg-[var(--accent-primary)]/15'
                          : 'bg-[var(--bg-input)]'
                      }`}
                    >
                      <FileOutput
                        size={16}
                        className={
                          outputMode === 'consolidado'
                            ? 'text-[var(--accent-primary)]'
                            : 'text-[var(--text-muted)]'
                        }
                      />
                    </div>
                    <div className="flex flex-col min-w-0">
                      <span
                        className={`text-xs font-medium ${
                          outputMode === 'consolidado' ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'
                        }`}
                      >
                        PDF Consolidado
                      </span>
                      <span className="text-[10px] text-[var(--text-muted)] leading-tight">
                        Todas las ubicaciones en un solo archivo
                      </span>
                    </div>
                  </button>
                </div>
              </section>
            </div>

          </div>
        </div>

        {/* Sticky Generate Button (fixed bottom) */}
        <div className="shrink-0 border-t border-[var(--border-subtle)] bg-[var(--bg-base)] px-5 py-2">
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

      {/* ── Main: Preview & Results ── */}
      <div className="flex-1 flex flex-col bg-[var(--bg-elevated)] overflow-hidden">
        {result ? (
          <ResultPanel result={result} outputDir={outputDir} />
        ) : excelFile ? (
          <RealPreviewPanel
            preview={preview}
            loading={previewLoading}
            error={previewError}
            rowIndex={previewRowIndex}
            totalFilas={preview?.total_filas ?? 0}
            isProcessing={isProcessing}
            onPrev={handlePrevRow}
            onNext={handleNextRow}
            onRefresh={() => fetchPreview(previewRowIndex)}
          />
        ) : (
          <EmptyPreviewPanel formato={formato} />
        )}
      </div>
    </div>
  );
};

// ──────────────────────────────────────────────
// Empty Preview (no Excel loaded yet)
// ──────────────────────────────────────────────
const EmptyPreviewPanel: React.FC<{ formato: string }> = ({ formato }) => (
  <div className="flex-1 flex flex-col overflow-hidden">
    <div className="shrink-0 flex items-center gap-2.5 px-5 h-11 border-b border-[var(--border-subtle)] bg-[var(--bg-base)]">
      <Eye size={18} className="text-[var(--accent-primary)] shrink-0" />
      <span className="text-sm font-semibold text-[var(--text-primary)]">Vista Previa de Plantilla</span>
    </div>
    <div className="flex-1 flex flex-col items-center justify-center p-8">
    <div
      className={`relative bg-[var(--bg-input)] shadow-inner overflow-hidden flex flex-col transition-all duration-500 rounded-lg border border-[var(--border-subtle)] ${
        formato === 'vertical' ? 'w-48 h-64' : 'w-64 h-48'
      }`}
    >
      {/* Dotted background pattern using CSS variable */}
      <div
        className="absolute inset-0 opacity-20"
        style={{
          backgroundImage:
            'url("data:image/svg+xml,%3Csvg width=\'20\' height=\'20\' viewBox=\'0 0 20 20\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cg fill=\'%23666666\' fill-opacity=\'0.5\' fill-rule=\'evenodd\'%3E%3Ccircle cx=\'3\' cy=\'3\' r=\'3\'/%3E%3Ccircle cx=\'13\' cy=\'13\' r=\'3\'/%3E%3C/g%3E%3C/svg%3E")',
        }}
      />
      <div className="absolute inset-0 bg-[var(--bg-base)]/30" />
      <div className="relative z-10 flex flex-col items-center w-full h-full p-2">
        <div className="w-3/4 h-2.5 bg-[var(--text-primary)] rounded-sm mt-2 mb-3" />
        <div className="w-5/6 h-1.5 bg-[var(--text-secondary)] rounded-sm mb-1" />
        <div className="w-1/2 h-1.5 bg-[var(--text-secondary)] rounded-sm mb-1" />
        <div className="w-2/3 h-1.5 bg-[var(--text-secondary)] rounded-sm mb-3" />
        <div className="flex-1 flex items-center justify-center">
          <MapPin className="w-7 h-7 text-[var(--accent-primary)] drop-shadow-md" fill="currentColor" />
        </div>
        <div className="w-full h-5 bg-[var(--bg-base)] mt-auto rounded-sm flex items-center justify-center">
          <div className="w-1/2 h-1 bg-[var(--text-muted)] rounded-full" />
        </div>
      </div>
    </div>
      <p className="text-[11px] text-[var(--text-muted)] mt-6 max-w-xs text-center leading-relaxed">
        Sube un Excel para ver la vista previa real del resultado.
      </p>
    </div>
  </div>
);

// ──────────────────────────────────────────────
// Real Preview Panel (with actual generated image)
// ──────────────────────────────────────────────
const RealPreviewPanel: React.FC<{
  preview: PreviewData;
  loading: boolean;
  error: string | null;
  rowIndex: number;
  totalFilas: number;
  isProcessing: boolean;
  onPrev: () => void;
  onNext: () => void;
  onRefresh: () => void;
}> = ({ preview, loading, error, rowIndex, totalFilas, isProcessing, onPrev, onNext, onRefresh }) => (
  <div className="flex-1 flex flex-col overflow-hidden">
    {/* Toolbar — h-11 matches sidebar title bar for horizontal alignment */}
    <div className="shrink-0 flex items-center justify-between px-5 h-11 border-b border-[var(--border-subtle)] bg-[var(--bg-base)]">
      <div className="flex items-center gap-2.5">
        <Eye size={18} className="text-[var(--accent-primary)] shrink-0" />
        <span className="text-sm font-semibold text-[var(--text-primary)]">Vista Previa Real</span>
      </div>

      {totalFilas > 0 && (
        <div className="flex items-center gap-1">
          <button
            onClick={onPrev}
            disabled={rowIndex === 0 || loading}
            aria-label="Fila anterior"
            className="p-1.5 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-[var(--text-muted)]"
          >
            <ChevronLeft size={16} />
          </button>
          <span className="text-[11px] text-[var(--text-muted)] tabular-nums min-w-[3rem] text-center">
            {rowIndex + 1} / {totalFilas}
          </span>
          <button
            onClick={onNext}
            disabled={rowIndex >= totalFilas - 1 || loading}
            aria-label="Fila siguiente"
            className="p-1.5 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-[var(--text-muted)]"
          >
            <ChevronRight size={16} />
          </button>
          <button
            onClick={onRefresh}
            disabled={loading}
            aria-label="Actualizar vista previa"
            title="Actualizar vista previa"
            className="ml-1.5 p-1.5 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-[var(--text-muted)]"
          >
            <Loader2 size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      )}
    </div>

    {/* Preview Content */}
    <div className="flex-1 overflow-hidden flex items-center justify-center bg-[var(--bg-elevated)] p-6 relative">
      {error ? (
        <div className="flex flex-col items-center gap-3 max-w-sm">
          <div className="w-12 h-12 rounded-full bg-[var(--accent-red)]/15 flex items-center justify-center">
            <AlertCircle size={24} className="text-[var(--accent-red)]" />
          </div>
          <p className="text-sm font-medium text-[var(--accent-red)]">Error en vista previa</p>
          <p className="text-xs text-[var(--text-muted)] text-center break-words leading-relaxed">{error}</p>
        </div>
      ) : preview ? (
        <div className="flex flex-col items-center gap-4 w-full h-full relative">
          <div className="flex-1 w-full flex items-center justify-center overflow-hidden relative">
            {loading && (
              <div className="absolute top-3 right-3 z-10 flex items-center gap-2 rounded-lg bg-[var(--bg-base)]/90 border border-[var(--border-subtle)] px-2.5 py-1.5 shadow-sm">
                <Loader2 size={14} className="animate-spin text-[var(--accent-primary)]" />
                <span className="text-[10px] text-[var(--text-muted)]">Actualizando...</span>
              </div>
            )}
            <img
              src={preview.image}
              alt={`Ubicacion ${preview.cod_componente}`}
              className="w-full h-full object-contain rounded-xl shadow-2xl border border-[var(--border-subtle)] transition-opacity duration-150"
              style={{ opacity: loading ? 0.85 : 1 }}
            />
          </div>
          {/* Metadata bar - below image */}
          <div className="flex items-center gap-3 shrink-0 px-4 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] max-w-full overflow-hidden">
            <span className="text-sm font-bold text-[var(--text-primary)] shrink-0">{preview.cod_componente}</span>
            <span className="text-xs text-[var(--text-muted)] shrink-0">|</span>
            <span className="text-xs text-[var(--text-secondary)] truncate">{preview.direccion}</span>
            <span className="text-xs text-[var(--text-muted)] shrink-0">|</span>
            <span className="text-[11px] text-[var(--text-muted)] shrink-0">
              {preview.localidad} - {preview.distrito}
            </span>
          </div>
          {isProcessing && (
            <div className="flex items-center gap-2 text-[var(--text-secondary)] shrink-0">
              <Loader2 size={14} className="animate-spin text-[var(--accent-primary)]" />
              <span className="text-xs">Generando PDFs...</span>
            </div>
          )}
        </div>
      ) : loading ? (
        <div className="flex flex-col items-center gap-3">
          <Loader2 size={32} className="animate-spin text-[var(--accent-primary)]" />
          <p className="text-xs text-[var(--text-muted)]">Cargando mapa...</p>
        </div>
      ) : null}
    </div>
  </div>
);

// ──────────────────────────────────────────────
// Result Panel
// ──────────────────────────────────────────────
export const ResultPanel: React.FC<{ result: Result; outputDir: string }> = ({ result, outputDir }) => {
  if (!result) return null;

  if (result.success) {
    const isConsolidado = result.data?.consolidado;
    const generados = result.data?.generados ?? 0;
    const fallidos = result.data?.fallidos ?? 0;
    const allFailed = generados === 0 && fallidos > 0;
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8">
        <div className={`w-16 h-16 rounded-full flex items-center justify-center mb-5 ${allFailed ? 'bg-amber-500/15' : 'bg-emerald-500/15'}`}>
          {allFailed ? (
            <AlertCircle size={32} className="text-amber-400" />
          ) : (
            <CheckCircle2 size={32} className="text-emerald-400" />
          )}
        </div>
        <p className="text-lg font-semibold text-[var(--text-primary)] mb-1">
          {allFailed ? 'Proceso completado con errores' : 'Proceso completado'}
        </p>
        <p className="text-sm text-[var(--text-muted)] mb-5">
          {isConsolidado ? (
            <>
              Se generó <span className="font-bold text-emerald-400">1 PDF consolidado</span> con{' '}
              <span className="font-bold text-emerald-400">{generados} páginas</span>
            </>
          ) : (
            <>
              Se generaron{' '}
              <span className="font-bold text-emerald-400">{generados} PDFs</span>
            </>
          )}
        </p>
        {fallidos > 0 && (
          <p className="text-sm text-amber-400 mb-5">
            {fallidos} fila{fallidos !== 1 ? 's' : ''} omitida{fallidos !== 1 ? 's' : ''} por error
          </p>
        )}
        <div className="max-w-md w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
          <div className="flex items-center gap-2 mb-1.5">
            <Folder size={14} className="text-[var(--text-muted)] shrink-0" />
            <span className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">
              Carpeta de salida
            </span>
          </div>
          <p className="text-xs font-mono text-[var(--text-secondary)] break-all leading-relaxed">
            {result.data?.outputDir || outputDir}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8">
      <div className="w-16 h-16 rounded-full bg-[var(--accent-red)]/15 flex items-center justify-center mb-5">
        <AlertCircle size={32} className="text-[var(--accent-red)]" />
      </div>
      <p className="text-lg font-semibold text-[var(--accent-red)] mb-3">Error</p>
      <div className="max-w-md w-full rounded-xl border border-[var(--accent-red)]/20 bg-[var(--accent-red)]/5 p-4">
        <p className="text-sm text-[var(--accent-red)]/90 break-words leading-relaxed">{result.error}</p>
      </div>
    </div>
  );
};
