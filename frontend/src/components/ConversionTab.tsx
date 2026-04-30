import { useEffect, useState, useCallback } from 'react';
import { api, onNotify } from '../api';
import { LogEntry, PreviewItem, ProcessStatus, RenamePattern } from '../types';
import Button from './ui/Button';
import Badge from './ui/Badge';
import Thumbnail from './Thumbnail';
import ImagePreview from './ImagePreview';
import { useToast } from '../hooks/useToast';
import { useDialog } from '../hooks/useDialog';
import EmptyState from './ui/EmptyState';

const STEPS = [
  { id: 'files' as const, label: 'Archivos' },
  { id: 'options' as const, label: 'Opciones' },
  { id: 'rename' as const, label: 'Renombrado' },
  { id: 'output' as const, label: 'Salida' },
];

type NamingMode = 'keep' | 'code_name' | 'code_seq' | 'sequential' | 'custom' | string;

const fileNameFromPath = (path: string) => path.split(/[\\/]/).pop() || path;

const buildDefaultPresets = (fields: string[]): RenamePattern[] => {
  const codeField = fields[0];
  const nameField = fields[1];
  const codeNamePattern = codeField && nameField ? `{${codeField}}_{${nameField}}_{seq}{ext}` : codeField ? `{${codeField}}_{seq}{ext}` : 'img_{seq}{ext}';
  const codeSeqPattern = codeField ? `{${codeField}}_{seq}{ext}` : 'img_{seq}{ext}';
  return [
    { id: 'code_name', label: 'BD + número', pattern: codeNamePattern },
    { id: 'code_seq', label: 'Código + número', pattern: codeSeqPattern },
    { id: 'sequential', label: 'IMG + número', pattern: 'img_{seq}{ext}' },
    { id: 'keep', label: 'Mantener nombres', pattern: '' },
  ];
};

const exampleFromPattern = (pattern: string, fields: string[], firstFile?: string) => {
  const originalName = firstFile ? fileNameFromPath(firstFile) : '1.jpg';
  const dotIndex = originalName.lastIndexOf('.');
  const ext = dotIndex >= 0 ? originalName.slice(dotIndex) : '.jpg';
  if (!pattern) return originalName;

  const values: Record<string, string> = {
    seq: '001',
    ext,
  };
  fields.forEach((field, index) => {
    values[field] = index === 0 ? '1' : index === 1 ? 'producto' : '';
  });

  return pattern.replace(/\{([^}]+)\}/g, (_, key: string) => values[key] ?? '').replace(/_+(?=\.)/g, '');
};

const usesSequence = (pattern: string) => pattern.includes('{seq}');
const parsePositiveInt = (value: string) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};
const DEFAULT_FORMATS = ['JPEG', 'PNG', 'WEBP', 'TIFF'];
const DEFAULT_FIELDS = ['codigo', 'nombre'];
const DEFAULT_PATTERN = '{codigo}_{nombre}_{seq}{ext}';

export default function ConversionTab() {
  const { addToast } = useToast();
  const { confirm } = useDialog();
  const [files, setFiles] = useState<string[]>([]);
  const [destino, setDestino] = useState('');
  const [formato, setFormato] = useState('JPEG');
  const [calidad, setCalidad] = useState(95);
  const [resizeAncho, setResizeAncho] = useState('');
  const [resizeAlto, setResizeAlto] = useState('');
  const [resizeEnabled, setResizeEnabled] = useState(false);
  const [keepExif, setKeepExif] = useState(false);
  const [usarRename, setUsarRename] = useState(true);
  const [patron, setPatron] = useState(DEFAULT_PATTERN);
  const [secuencia, setSecuencia] = useState(1);
  const [useFilenameSeq, setUseFilenameSeq] = useState(true);
  const [namingMode, setNamingMode] = useState<NamingMode>('code_name');
  const [showAdvancedNaming, setShowAdvancedNaming] = useState(false);
  const [showPatternManager, setShowPatternManager] = useState(false);
  const [formats, setFormats] = useState<string[]>(DEFAULT_FORMATS);
  const [fields, setFields] = useState<string[]>(DEFAULT_FIELDS);
  const [patterns, setPatterns] = useState<RenamePattern[]>([]);
  const [status, setStatus] = useState<ProcessStatus | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [preview, setPreview] = useState<PreviewItem[] | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [showTerminal, setShowTerminal] = useState(false);
  const [running, setRunning] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [activeStep, setActiveStep] = useState<'files' | 'options' | 'rename' | 'output'>('files');

  const stepIndex = STEPS.findIndex((s) => s.id === activeStep);
  const namingPresets = patterns.length > 0 ? patterns : buildDefaultPresets(fields);
  const namingExample = exampleFromPattern(usarRename ? patron : '', fields, files[0]);
  const showSequenceControls = usarRename && usesSequence(patron);
  const dbMatchedCount = preview?.filter((item) => item.en_bd).length ?? 0;
  const resizeWidth = resizeEnabled ? parsePositiveInt(resizeAncho) : null;
  const resizeHeight = resizeEnabled ? parsePositiveInt(resizeAlto) : null;
  const filesReady = files.length > 0;
  const optionsReady = Boolean(formato) && (!resizeEnabled || (resizeWidth !== null && resizeHeight !== null));
  const renameReady = !usarRename || patron.trim().length > 0;
  const outputReady = destino.trim().length > 0;
  const allReady = filesReady && optionsReady && renameReady && outputReady;
  const currentStepReady =
    activeStep === 'files' ? filesReady :
    activeStep === 'options' ? optionsReady :
    activeStep === 'rename' ? renameReady :
    outputReady;
  const canGoNext = currentStepReady && stepIndex < STEPS.length - 1;

  const goNext = () => {
    if (canGoNext) setActiveStep(STEPS[stepIndex + 1].id);
  };
  const goPrev = () => {
    if (stepIndex > 0) setActiveStep(STEPS[stepIndex - 1].id);
  };

  const getStepStatus = (idx: number) => {
    if (idx < stepIndex) return 'completed' as const;
    if (idx === stepIndex) return 'active' as const;
    return 'pending' as const;
  };

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === 'HISTORY_REEXECUTE') {
        const run = e.data.payload;
        const files = JSON.parse(run.files_json || '[]');
        const options = JSON.parse(run.options_json || '{}');
        setFiles(files);
        setFormato(options.formato || 'JPEG');
        setCalidad(options.calidad || 95);
        setPatron(run.patron || '');
        setUsarRename(options.usar_rename !== false && Boolean(run.patron));
        setNamingMode(options.usar_rename === false ? 'keep' : 'custom');
        if (options.resize) {
          const parts = options.resize.replace(/[()\[\]]/g, '').split(',');
          if (parts.length === 2) {
            setResizeAncho(parts[0].trim());
            setResizeAlto(parts[1].trim());
            setResizeEnabled(true);
          }
        }
        setActiveStep('files');
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  useEffect(() => {
    api.formats().then((r) => setFormats(r.formats.length ? r.formats : DEFAULT_FORMATS)).catch(() => setFormats(DEFAULT_FORMATS));
    api.getFields().then((r) => {
      const names = r.fields.map((f) => f.name);
      const effectiveNames = names.length ? names : DEFAULT_FIELDS;
      setFields(effectiveNames);
      const defaultPat = effectiveNames.length >= 2 ? `{${effectiveNames[0]}}_{${effectiveNames[1]}}_{seq}{ext}` : `{${effectiveNames[0]}}_{seq}{ext}`;
      setPatron(defaultPat);
      setNamingMode(effectiveNames.length >= 2 ? 'code_name' : 'code_seq');
    }).catch(() => {
      setFields(DEFAULT_FIELDS);
      setPatron(DEFAULT_PATTERN);
      setNamingMode('code_name');
    });
    api.getRenamePatterns().then((r) => {
      if (r.patterns && r.patterns.length > 0) {
        setPatterns(r.patterns);
      }
    }).catch(() => {});
    const iv = setInterval(pollStatus, 1000);
    return () => clearInterval(iv);
  }, []);

  const pollStatus = async () => {
    try {
      const s = await api.getStatus();
      setStatus(s);
      setLogs(s.logs);
      setRunning(s.running);
    } catch { /* ignore */ }
  };

  useEffect(() => {
    const unsub = onNotify((method, _params) => {
      if (method === 'process.progress' || method === 'process.complete') pollStatus();
    });
    return unsub;
  }, []);

  const mergeFiles = useCallback((incoming: string[]) => {
    if (!incoming.length) return;
    setFiles((prev) => Array.from(new Set([...prev, ...incoming])));
    setSelectedFile((prev) => prev || incoming[0]);
  }, []);

  const addFiles = async () => {
    const r = await api.dialogFiles();
    mergeFiles(r.paths);
  };

  const addFolder = async () => {
    const r = await api.dialogFolder();
    if (!r.paths.length) return;
    const scanned = await api.scanFolder(r.paths[0]);
    mergeFiles(scanned.files);
  };

  const selectDest = async () => {
    const r = await api.dialogDest();
    if (r.paths.length) setDestino(r.paths[0]);
  };

  const toggleResize = (enabled: boolean) => {
    setResizeEnabled(enabled);
    if (!enabled) {
      setResizeAncho('');
      setResizeAlto('');
    }
  };

  const clearFiles = () => {
    setFiles([]);
    setSelectedFile(null);
  };
  const insertVar = (v: string) => {
    setNamingMode('custom');
    setUsarRename(true);
    setPatron((p) => p + v);
  };

  const chooseNamingPreset = (preset: RenamePattern) => {
    setNamingMode(preset.id);
    setUsarRename(preset.id !== 'keep' && preset.pattern !== '');
    setPatron(preset.pattern);
    setPreview(null);
  };

  const savePatterns = async (updated: RenamePattern[]) => {
    try {
      const r = await api.updateRenamePatterns(updated);
      setPatterns(r.patterns);
    } catch (err) {
      addToast({ message: `Error guardando patrones: ${err instanceof Error ? err.message : String(err)}`, type: 'error' });
    }
  };

  const addCustomPattern = () => {
    const id = `custom_${Date.now()}`;
    const updated = [...patterns, { id, label: 'Nuevo patrón', pattern: '{codigo}{ext}' }];
    savePatterns(updated);
  };

  const updatePattern = (index: number, field: keyof RenamePattern, value: string) => {
    const updated = patterns.map((p, i) => i === index ? { ...p, [field]: value } : p);
    savePatterns(updated);
  };

  const removePattern = async (index: number) => {
    if (patterns.length <= 1) {
      addToast({ message: 'Debe quedar al menos un patrón', type: 'warning' });
      return;
    }
    const ok = await confirm({ title: 'Eliminar patrón', description: '¿Eliminar este patrón de renombrado?', type: 'destructive', confirmLabel: 'Eliminar' });
    if (!ok) return;
    const updated = patterns.filter((_, i) => i !== index);
    savePatterns(updated);
  };

  const resetPatterns = async () => {
    const ok = await confirm({ title: 'Restaurar patrones', description: '¿Restaurar patrones por defecto?' });
    if (!ok) return;
    try {
      const r = await api.resetRenamePatterns();
      setPatterns(r.patterns);
      addToast({ message: 'Patrones restaurados correctamente', type: 'success' });
    } catch (err) {
      addToast({ message: `Error restaurando patrones: ${err instanceof Error ? err.message : String(err)}`, type: 'error' });
    }
  };

  useEffect(() => {
    if (!usarRename || !files.length || !patron) {
      setPreview(null);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const r = await api.preview({ files, patron, secuencia, use_filename_seq: useFilenameSeq });
        if (!cancelled) setPreview(r.preview);
      } catch {
        if (!cancelled) setPreview(null);
      }
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [files, patron, secuencia, useFilenameSeq, usarRename]);

  const doProcess = async () => {
    if (!allReady) return;
    const body = {
      files, destino, formato, calidad,
      resize_ancho: resizeAncho ? parseInt(resizeAncho) : null,
      resize_alto: resizeAlto ? parseInt(resizeAlto) : null,
      keep_exif: keepExif, usar_rename: usarRename, patron, secuencia,
      use_filename_seq: useFilenameSeq,
    };
    await api.startProcess(body);
    setRunning(true);
    pollStatus();
  };

  const doCancel = async () => {
    await api.cancelProcess();
    pollStatus();
  };

  const onDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); setDragOver(true); }, []);
  const onDragLeave = useCallback((e: React.DragEvent) => { e.preventDefault(); setDragOver(false); }, []);
  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const dropped = Array.from(e.dataTransfer.files).map((f: any) => f.path || f.name);
    mergeFiles(dropped);
  }, [mergeFiles]);
  const removeFile = (path: string) => {
    setFiles((prev) => {
      const next = prev.filter((p) => p !== path);
      setSelectedFile((selected) => {
        if (selected !== path) return selected;
        const idx = prev.indexOf(path);
        return next[idx] || next[idx - 1] || null;
      });
      setSelectedFiles((s) => {
        const ns = new Set(s);
        ns.delete(path);
        return ns;
      });
      return next;
    });
  };

  const removeSelectedFiles = () => {
    setFiles((prev) => {
      const next = prev.filter((p) => !selectedFiles.has(p));
      setSelectedFile((selected) => (selected && next.includes(selected) ? selected : next[0] || null));
      setSelectedFiles(new Set());
      return next;
    });
  };

  const handleFileClick = (e: React.MouseEvent, path: string) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      setSelectedFiles((prev) => {
        const next = new Set(prev);
        if (next.has(path)) next.delete(path);
        else next.add(path);
        return next;
      });
      setSelectedFile(path);
    } else if (e.shiftKey && selectedFile) {
      e.preventDefault();
      const idx1 = files.indexOf(selectedFile);
      const idx2 = files.indexOf(path);
      const start = Math.min(idx1, idx2);
      const end = Math.max(idx1, idx2);
      setSelectedFiles((prev) => {
        const next = new Set(prev);
        for (let i = start; i <= end; i++) next.add(files[i]);
        return next;
      });
      setSelectedFile(path);
    } else {
      setSelectedFile(path);
      setSelectedFiles(new Set([path]));
    }
  };

  const selectAllFiles = () => {
    if (selectedFiles.size === files.length) {
      setSelectedFiles(new Set());
    } else {
      setSelectedFiles(new Set(files));
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedFiles.size > 0 && activeStep === 'files') {
        e.preventDefault();
        removeSelectedFiles();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedFiles, activeStep]);

  return (
    <div className="flex h-full w-full bg-dark-base">
      <div className="flex min-w-0 flex-1 flex-col">
      {/* Content area */}
      <div className="flex-1 min-h-0 px-8 pt-8 animate-fade-in" key={activeStep}>
        {activeStep === 'files' && (
          <div className="flex flex-col h-full">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-xl font-semibold text-txt-primary">Archivos de origen</h3>
                {!filesReady && <p className="mt-1 text-sm text-accent-yellow">Carga imagenes para continuar.</p>}
              </div>
              <div className="flex items-center gap-3">
                {files.length > 0 && (
                  <>
                    <span className="text-xs text-txt-muted">
                      {selectedFiles.size > 0 ? `${selectedFiles.size} seleccionados` : `${files.length} total`}
                    </span>
                    <Button variant="ghost" onClick={selectAllFiles}>
                      {selectedFiles.size === files.length ? 'Deseleccionar' : 'Seleccionar todos'}
                    </Button>
                    {selectedFiles.size > 0 && (
                      <Button variant="ghost" onClick={removeSelectedFiles} className="text-accent-red hover:text-accent-red">
                        Eliminar {selectedFiles.size}
                      </Button>
                    )}
                  </>
                )}
                <Button variant="secondary" onClick={addFiles}>Imágenes</Button>
                <Button variant="secondary" onClick={addFolder}>Carpeta</Button>
                {files.length > 0 && <Button variant="ghost" onClick={clearFiles}>Limpiar</Button>}
              </div>
            </div>

            <div
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
              className={`flex-1 rounded-card border-2 border-dashed transition-all duration-300 flex flex-col overflow-hidden ${
                dragOver
                  ? 'border-accent bg-accent/5 shadow-glow scale-[1.01]'
                  : 'border-bdr-medium bg-dark-surface hover:border-bdr-active'
              }`}
            >
              {files.length === 0 ? (
                <EmptyState
                  icon={
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-txt-muted">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="17 8 12 3 7 8" />
                      <line x1="12" y1="3" x2="12" y2="15" />
                    </svg>
                  }
                  title="Arrastra imágenes aquí"
                  description="Formatos soportados: JPG, PNG, WEBP, TIFF, BMP, GIF"
                  action={{ label: 'Seleccionar archivos', onClick: addFiles }}
                />
              ) : (
                <div className="flex-1 p-4 overflow-y-auto">
                  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                    {files.map((f) => {
                      const isSelected = selectedFiles.has(f);
                      const isPrimary = selectedFile === f;
                      return (
                        <div
                          key={f}
                          className={`group overflow-hidden rounded-card text-xs transition-all duration-200 cursor-pointer border ${
                            isPrimary
                              ? 'bg-accent/10 border-accent shadow-glow'
                              : isSelected
                              ? 'bg-accent/5 border-accent/40'
                              : 'bg-dark-elevated border-bdr-subtle hover:border-bdr-medium hover:bg-[#1d1d1d]'
                          }`}
                          onClick={(e) => handleFileClick(e, f)}
                        >
                          <div className="relative aspect-[16/10] bg-dark-input">
                            <Thumbnail path={f} variant="card" />
                            {/* Selection checkbox */}
                            <div className={`absolute left-2 top-2 flex h-6 w-6 items-center justify-center rounded-full border-2 transition-all ${
                              isSelected ? 'bg-accent border-accent' : 'bg-black/40 border-white/30 group-hover:border-white/60'
                            }`}>
                              {isSelected && (
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                  <polyline points="20 6 9 17 4 12" />
                                </svg>
                              )}
                            </div>
                            <button
                              onClick={(e) => { e.stopPropagation(); removeFile(f); }}
                              className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-black/55 text-white opacity-0 shadow-sm backdrop-blur-sm transition-all duration-200 hover:bg-accent-red group-hover:opacity-100"
                              title="Quitar"
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                            </button>
                          </div>
                          <div className="space-y-1 px-3 py-3">
                            <div className="flex items-center gap-2">
                              <span className={`h-1.5 w-1.5 rounded-full ${isPrimary ? 'bg-accent' : 'bg-txt-muted'}`} />
                              <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-txt-primary">{f.split(/[\\/]/).pop()}</span>
                            </div>
                            <span className="block truncate font-mono text-[10px] text-txt-muted">{f}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {selectedFile && (
              <div className="h-64 shrink-0 border border-bdr-subtle bg-dark-surface rounded-card p-4 mt-4">
                <ImagePreview
                  path={selectedFile}
                  formato={formato}
                  calidad={calidad}
                  resizeAncho={resizeAncho}
                  resizeAlto={resizeAlto}
                />
              </div>
            )}

            <div className="flex items-center justify-between mt-4 shrink-0 px-2">
              <Badge variant={files.length ? 'success' : 'default'}>
                {files.length} archivo{files.length !== 1 ? 's' : ''} cargados
              </Badge>
              {files.length > 0 && (
                <span className="text-sm font-medium text-txt-secondary">
                  {selectedFiles.size > 0 ? `${selectedFiles.size} seleccionados` : 'Listo para configurar'}
                </span>
              )}
            </div>
          </div>
        )}

        {activeStep === 'options' && (
          <div className="flex flex-col h-full">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h3 className="text-xl font-semibold text-txt-primary">Conversión</h3>
                <p className="text-sm text-txt-muted mt-1">Elige formato, calidad y tamaño de salida.</p>
              </div>
              <Badge variant="default">{formato} · {calidad}%</Badge>
            </div>

            <div className="bg-dark-surface border border-bdr-subtle rounded-card overflow-hidden">
              <div className="grid grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)] border-b border-bdr-subtle">
                <div className="p-5 lg:border-r border-b lg:border-b-0 border-bdr-subtle">
                  <label className="text-[11px] font-bold uppercase tracking-widest text-txt-muted block mb-2">Formato</label>
                  <select
                    className="w-full appearance-none cursor-pointer text-base py-3 font-semibold bg-dark-input border border-bdr-medium rounded-btn px-3 text-txt-primary focus:border-accent focus:outline-none"
                    value={formato}
                    onChange={(e) => setFormato(e.target.value)}
                  >
                    {formats.map((f) => <option key={f} value={f}>{f}</option>)}
                  </select>
                </div>

                <div className="p-5">
                  <label className="text-[11px] font-bold uppercase tracking-widest text-txt-muted flex justify-between mb-3">
                    Calidad
                    <span className="text-accent font-bold">{calidad}%</span>
                  </label>
                  <input
                    type="range"
                    min={1}
                    max={100}
                    className="w-full accent-accent h-2 bg-dark-input rounded-lg appearance-none cursor-pointer"
                    value={calidad}
                    onChange={(e) => setCalidad(parseInt(e.target.value))}
                  />
                  <div className="flex justify-between text-[11px] text-txt-muted mt-2">
                    <span>Ligero</span>
                    <span>Nítido</span>
                  </div>
                </div>
              </div>

              <div className="divide-y divide-bdr-subtle">
                <div className="p-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <label className="flex items-center gap-3 cursor-pointer select-none">
                    <div className="relative">
                      <input
                        type="checkbox"
                        className="peer sr-only"
                        checked={resizeEnabled}
                        onChange={(e) => toggleResize(e.target.checked)}
                      />
                      <div className="w-11 h-6 rounded-full bg-dark-input border border-bdr-medium peer-checked:bg-accent transition-colors" />
                      <div className="absolute left-1 top-1 w-4 h-4 rounded-full bg-white transition-transform peer-checked:translate-x-5 shadow-sm" />
                    </div>
                    <span className="text-sm font-semibold text-txt-primary">Redimensionar</span>
                  </label>

                  {resizeEnabled && (
                    <div>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          placeholder="Ancho"
                          className="w-28 text-center font-mono py-2.5 bg-dark-input border border-bdr-medium rounded-btn px-3 text-txt-primary focus:border-accent focus:outline-none"
                          value={resizeAncho}
                          onChange={(e) => setResizeAncho(e.target.value)}
                        />
                        <span className="text-txt-muted font-bold">×</span>
                        <input
                          type="number"
                          placeholder="Alto"
                          className="w-28 text-center font-mono py-2.5 bg-dark-input border border-bdr-medium rounded-btn px-3 text-txt-primary focus:border-accent focus:outline-none"
                          value={resizeAlto}
                          onChange={(e) => setResizeAlto(e.target.value)}
                        />
                      </div>
                      {!optionsReady && <p className="mt-2 text-right text-sm text-accent-yellow">Ingresa ancho y alto validos.</p>}
                    </div>
                  )}
                </div>

                <label className="p-5 flex items-center justify-between gap-4 cursor-pointer select-none">
                  <div>
                    <span className="text-sm font-semibold text-txt-primary block">Preservar metadatos EXIF</span>
                    <span className="text-xs text-txt-muted">Cámara, fecha y GPS cuando el formato lo permita.</span>
                  </div>
                  <div className="relative shrink-0">
                    <input
                      type="checkbox"
                      className="peer sr-only"
                      checked={keepExif}
                      onChange={(e) => setKeepExif(e.target.checked)}
                    />
                    <div className="w-11 h-6 rounded-full bg-dark-input border border-bdr-medium peer-checked:bg-accent transition-colors" />
                    <div className="absolute left-1 top-1 w-4 h-4 rounded-full bg-white transition-transform peer-checked:translate-x-5 shadow-sm" />
                  </div>
                </label>
              </div>
            </div>
          </div>
        )}

        {activeStep === 'rename' && (
          <div className="flex flex-col h-full">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h3 className="text-xl font-semibold text-txt-primary">Renombrado</h3>
                <p className="text-sm text-txt-muted mt-1">Elige una regla simple y revisa el resultado antes de iniciar.</p>
                {!renameReady && <p className="mt-1 text-sm text-accent-yellow">El patron no puede estar vacio.</p>}
              </div>
              <Badge variant={files.length && dbMatchedCount === files.length ? 'success' : files.length ? 'warning' : 'default'}>
                {!usarRename
                  ? 'Mantener nombres'
                  : files.length
                    ? `${dbMatchedCount}/${files.length} con BD`
                    : 'Activo'}
              </Badge>
            </div>

            <div className="bg-dark-surface border border-bdr-subtle rounded-card overflow-hidden flex flex-col min-h-0">
              {files.length > 0 && usarRename && dbMatchedCount < files.length && (
                <div className="px-5 py-3 border-b border-accent-yellow/20 bg-accent-yellow/10 text-accent-yellow text-sm">
                  No todos los archivos coinciden con la base de datos. Se busca por codigo, nombre, marca, modelo y cualquier otro campo importado.
                </div>
              )}
              <div className="p-5 border-b border-bdr-subtle">
                <label className="text-[11px] font-bold uppercase tracking-widest text-txt-muted block mb-3">Nombre final</label>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                  {namingPresets.map((preset) => {
                    const active = namingMode === preset.id;
                    return (
                      <button
                        key={preset.id}
                        onClick={() => chooseNamingPreset(preset)}
                        className={`min-h-[72px] text-left px-4 py-3 rounded-btn border transition-all ${
                          active
                            ? 'bg-accent text-white border-accent shadow-glow'
                            : 'bg-dark-elevated border-bdr-subtle text-txt-secondary hover:text-txt-primary hover:border-bdr-medium'
                        }`}
                      >
                        <span className="block text-sm font-semibold">{preset.label}</span>
                        <span className={`block mt-2 font-mono text-[11px] truncate ${active ? 'text-white/75' : 'text-txt-muted'}`}>
                          {exampleFromPattern(preset.pattern, fields, files[0])}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {(showSequenceControls || showAdvancedNaming) && (
                <div className="px-5 py-4 border-b border-bdr-subtle space-y-4">
                  {showSequenceControls && (
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <label className="flex items-center gap-3 cursor-pointer select-none">
                        <div className="relative">
                          <input
                            type="checkbox"
                            className="peer sr-only"
                            checked={useFilenameSeq}
                            onChange={(e) => setUseFilenameSeq(e.target.checked)}
                          />
                          <div className="w-11 h-6 rounded-full bg-dark-input border border-bdr-medium peer-checked:bg-accent transition-colors" />
                          <div className="absolute left-1 top-1 w-4 h-4 rounded-full bg-white transition-transform peer-checked:translate-x-5 shadow-sm" />
                        </div>
                        <span className="text-sm font-semibold text-txt-primary">Usar número del archivo original</span>
                      </label>

                      {!useFilenameSeq && (
                        <div className="flex items-center gap-3">
                          <span className="text-xs text-txt-muted font-bold uppercase tracking-wider">Iniciar en</span>
                          <input
                            type="number"
                            min={1}
                            max={9999}
                            className="w-24 py-2 text-center font-mono bg-dark-input border border-bdr-medium rounded-btn px-3 text-txt-primary focus:border-accent focus:outline-none"
                            value={secuencia}
                            onChange={(e) => setSecuencia(parseInt(e.target.value) || 1)}
                          />
                        </div>
                      )}
                    </div>
                  )}

                  {showAdvancedNaming && (
                    <div className="space-y-3">
                      <input
                        className="w-full font-mono text-sm py-3 bg-dark-input border border-bdr-medium rounded-btn px-3 text-txt-primary focus:border-accent focus:outline-none"
                        value={patron}
                        onChange={(e) => {
                          setNamingMode('custom');
                          setUsarRename(true);
                          setPatron(e.target.value);
                        }}
                        placeholder="{codigo}_{nombre}{ext}"
                      />
                      <div className="flex flex-wrap gap-2">
                        {fields.map((f) => (
                          <button key={f} onClick={() => insertVar(`{${f}}`)} className="px-3 py-1.5 rounded-sm bg-dark-elevated text-txt-primary text-xs font-mono border border-bdr-subtle hover:bg-accent hover:text-white transition-colors">
                            {`{${f}}`}
                          </button>
                        ))}
                        <button onClick={() => insertVar('{seq}')} className="px-3 py-1.5 rounded-sm bg-accent/10 text-accent text-xs font-mono border border-accent/30 hover:bg-accent hover:text-white transition-colors">{'{seq}'}</button>
                        <button onClick={() => insertVar('{ext}')} className="px-3 py-1.5 rounded-sm bg-accent-blue/10 text-accent-blue text-xs font-mono border border-accent-blue/30 hover:bg-accent-blue hover:text-white transition-colors">{'{ext}'}</button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="px-5 py-3 border-b border-bdr-subtle flex items-center justify-between">
                <div className="flex gap-3">
                  <button
                    onClick={() => setShowAdvancedNaming((value) => !value)}
                    className="text-sm font-semibold text-accent hover:text-accent-orange-hover"
                  >
                    {showAdvancedNaming ? 'Ocultar patrón avanzado' : 'Editar patrón avanzado'}
                  </button>
                  <button
                    onClick={() => setShowPatternManager((value) => !value)}
                    className="text-sm font-semibold text-txt-secondary hover:text-txt-primary"
                  >
                    {showPatternManager ? 'Ocultar gestor' : 'Gestionar patrones'}
                  </button>
                </div>
                <span className="text-xs text-txt-muted">
                  Ejemplo: <span className="font-mono text-txt-primary">{namingExample}</span>
                </span>
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto p-3">
                <div className="flex items-center justify-between px-2 pb-2">
                  <span className="text-[11px] font-bold uppercase tracking-widest text-txt-muted">Vista previa</span>
                  <span className="text-xs text-txt-muted">{preview?.length || files.length} archivos</span>
                </div>

                {files.length === 0 && (
                  <div className="h-36 flex items-center justify-center text-txt-muted text-sm border border-dashed border-bdr-medium rounded-card">
                    Carga imágenes para ver los nuevos nombres.
                  </div>
                )}

                {files.length > 0 && !usarRename && (
                  <div className="space-y-1.5">
                    {files.map((f) => (
                      <div key={f} className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] gap-3 items-center px-3 py-2 rounded-sm bg-dark-elevated text-sm">
                        <span className="text-txt-muted truncate font-mono">{fileNameFromPath(f)}</span>
                        <span className="text-txt-muted">→</span>
                        <span className="text-txt-primary truncate font-mono">{fileNameFromPath(f)}</span>
                      </div>
                    ))}
                  </div>
                )}

                {files.length > 0 && usarRename && !preview && (
                  <div className="h-36 flex items-center justify-center text-txt-muted text-sm">Generando vista previa...</div>
                )}

                {usarRename && preview && (
                  <div className="space-y-1.5">
                    {preview.map((p, i) => (
                      <div key={i} className={`grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto] gap-3 items-center px-3 py-2 rounded-sm text-sm ${i % 2 === 0 ? 'bg-dark-elevated' : 'bg-transparent'}`}>
                        <span className="text-txt-muted truncate font-mono">{p.origen}</span>
                        <span className="text-txt-muted">→</span>
                        <span className="text-txt-primary font-semibold truncate font-mono">{p.nuevo}</span>
                        <Badge variant={p.en_bd ? 'success' : 'warning'} className="shrink-0">
                          {p.en_bd ? 'BD' : 'Sin BD'}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Pattern Manager */}
              {showPatternManager && (
                <div className="border-t border-bdr-subtle bg-dark-elevated p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-bold text-txt-primary">Gestor de Patrones</h4>
                    <div className="flex gap-2">
                      <Button variant="ghost" onClick={addCustomPattern}>Agregar</Button>
                      <Button variant="ghost" onClick={resetPatterns}>Restaurar defaults</Button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    {patterns.map((p, i) => (
                      <div key={p.id} className="grid grid-cols-[1fr_auto_auto] gap-2 items-center">
                        <input
                          className="font-mono text-xs py-1.5 bg-dark-input border border-bdr-medium rounded px-2 text-txt-primary focus:border-accent focus:outline-none"
                          value={p.label}
                          onChange={(e) => updatePattern(i, 'label', e.target.value)}
                          placeholder="Etiqueta"
                        />
                        <input
                          className="font-mono text-xs py-1.5 bg-dark-input border border-bdr-medium rounded px-2 text-txt-primary focus:border-accent focus:outline-none flex-1"
                          value={p.pattern}
                          onChange={(e) => updatePattern(i, 'pattern', e.target.value)}
                          placeholder="{codigo}_{nombre}{ext}"
                        />
                        <button
                          onClick={() => removePattern(i)}
                          className="text-txt-muted hover:text-red-400 px-2"
                          title="Eliminar"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {activeStep === 'output' && (
          <div className="flex flex-col h-full">
            <div className="mb-4">
              <h3 className="text-xl font-semibold text-txt-primary">Salida y Registro</h3>
              <p className="mt-1 text-sm text-txt-muted">Revisa el lote, elige destino y ejecuta cuando todo este listo.</p>
              {!outputReady && <p className="mt-1 text-sm text-accent-yellow">Selecciona una carpeta de destino.</p>}
            </div>

            <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="border-b border-bdr-subtle py-3">
                <span className="block text-[11px] font-bold uppercase tracking-widest text-txt-muted">Archivos</span>
                <span className="text-sm font-semibold text-txt-primary">{files.length} imagen{files.length !== 1 ? 'es' : ''}</span>
              </div>
              <div className="border-b border-bdr-subtle py-3">
                <span className="block text-[11px] font-bold uppercase tracking-widest text-txt-muted">Conversion</span>
                <span className="text-sm font-semibold text-txt-primary">{formato} · {calidad}%</span>
              </div>
              <div className="border-b border-bdr-subtle py-3">
                <span className="block text-[11px] font-bold uppercase tracking-widest text-txt-muted">Renombrado</span>
                <span className="block truncate text-sm font-semibold text-txt-primary">{usarRename ? namingExample : 'Mantener nombres'}</span>
              </div>
              <div className="border-b border-bdr-subtle py-3">
                <span className="block text-[11px] font-bold uppercase tracking-widest text-txt-muted">Destino</span>
                <span className={`block truncate text-sm font-semibold ${outputReady ? 'text-txt-primary' : 'text-accent-yellow'}`}>
                  {destino || 'Pendiente'}
                </span>
              </div>
            </div>

            <div className="mb-4">
              <label className="text-xs font-bold uppercase tracking-wider text-txt-muted mb-2 block">Carpeta de destino</label>
              <div className="flex gap-3">
                <input
                  className="flex-1 cursor-not-allowed font-mono text-sm py-3 bg-dark-input border border-bdr-medium rounded-sm px-3 text-txt-secondary"
                  value={destino}
                  readOnly
                  placeholder="Selecciona donde guardar las imágenes procesadas..."
                />
                <Button variant="secondary" onClick={selectDest} className="px-6">Examinar...</Button>
              </div>
            </div>

            {/* Logs Drawer */}
            <div className="flex-1 flex flex-col min-h-0">
              <button
                onClick={() => setShowTerminal((v) => !v)}
                className="flex items-center justify-between px-4 py-2.5 bg-dark-elevated border border-bdr-subtle rounded-t-card hover:bg-dark-input transition-colors"
              >
                <span className="text-[11px] font-bold uppercase tracking-widest text-txt-muted flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-accent-blue inline-block" />
                  Terminal de Actividad
                  {running && <span className="w-1.5 h-1.5 rounded-full bg-accent-green animate-pulse" />}
                </span>
                <div className="flex items-center gap-3">
                  <span className="text-xs font-mono text-txt-muted">{logs.length} líneas</span>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`text-txt-muted transition-transform ${showTerminal ? 'rotate-180' : ''}`}>
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </div>
              </button>

              <div className={`border-x border-b border-bdr-subtle bg-dark-surface rounded-b-card flex flex-col overflow-hidden transition-all duration-300 ${showTerminal ? 'flex-1 min-h-[200px]' : 'h-0'}`}>
                {showTerminal && (
                  <div className="flex-1 p-4 font-mono text-[13px] space-y-1.5 overflow-y-auto">
                    {logs.length === 0 && (
                      <div className="h-full flex flex-col items-center justify-center text-txt-muted/50">
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" className="mb-2">
                          <path d="M4 17l6-6-6-6 M12 19h8" />
                        </svg>
                        <span className="italic">Esperando ejecución...</span>
                      </div>
                    )}
                    {logs.map((l, i) => (
                      <div key={i} className={`px-3 py-1.5 rounded-sm border flex items-start gap-3 ${
                        l.tag === 'ok' ? 'text-accent-green bg-accent-green/5 border-accent-green/10' :
                        l.tag === 'error' ? 'text-accent-red bg-accent-red/5 border-accent-red/10' :
                        l.tag === 'warn' ? 'text-accent-yellow bg-accent-yellow/5 border-accent-yellow/10' :
                        'text-txt-secondary bg-dark-elevated border-bdr-subtle'
                      }`}>
                        <span className="opacity-50 text-[10px] mt-0.5 shrink-0 w-12">{new Date().toLocaleTimeString().split(' ')[0]}</span>
                        <span>{l.message}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Navigation bar */}
      <div className="shrink-0 px-8 py-4 border-t border-bdr-subtle bg-dark-surface">
        <div className="flex items-center justify-between">
          <Button
            variant="secondary"
            onClick={goPrev}
            disabled={stepIndex === 0}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            Anterior
          </Button>

          {/* Stepper horizontal compacto */}
          <div className="hidden md:flex items-center gap-1">
            {STEPS.map((step, idx) => {
              const st = getStepStatus(idx);
              return (
                <button
                  key={step.id}
                  onClick={() => setActiveStep(step.id)}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                    st === 'active'
                      ? 'bg-accent/10 text-accent-orange border border-accent/20'
                      : st === 'completed'
                      ? 'text-accent-green hover:bg-dark-elevated'
                      : 'text-txt-muted hover:bg-dark-elevated'
                  }`}
                >
                  <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${
                    st === 'active' ? 'bg-accent-orange text-white' :
                    st === 'completed' ? 'bg-accent-green text-white' :
                    'bg-dark-elevated text-txt-muted border border-bdr-medium'
                  }`}>
                    {st === 'completed' ? (
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
                    ) : idx + 1}
                  </span>
                  <span className="hidden lg:inline">{step.label}</span>
                  {idx < STEPS.length - 1 && (
                    <span className={`mx-1 w-4 h-px ${idx < stepIndex ? 'bg-accent-green' : 'bg-bdr-medium'}`} />
                  )}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-3">
            {status && (
              <div className="flex items-center gap-3 mr-4">
                {running && <span className="w-2 h-2 rounded-full bg-accent animate-pulse" />}
                <span className="text-xs text-txt-muted font-medium">
                  {running ? `Procesando... ${Math.round(status.progress)}%` : status.progress === 100 ? 'Completado' : ''}
                </span>
                {status.current_file && (
                  <span className="text-[11px] text-txt-muted font-mono truncate max-w-[200px]">{status.current_file}</span>
                )}
                {(status.ok_count > 0 || status.err_count > 0) && (
                  <div className="flex gap-2">
                    <Badge variant="success">{status.ok_count} OK</Badge>
                    {status.err_count > 0 && <Badge variant="error">{status.err_count} Err</Badge>}
                  </div>
                )}
              </div>
            )}

            {!running ? (
              <Button variant="primary" onClick={doProcess} disabled={!allReady} className="px-6">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
                Iniciar
              </Button>
            ) : (
              <Button variant="secondary" onClick={doCancel} className="px-6 text-accent-red hover:text-accent-red border-accent-red/30 hover:bg-accent-red/10">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="6" y="6" width="12" height="12" rx="2" />
                </svg>
                Detener
              </Button>
            )}
          </div>

          <Button
            variant="secondary"
            onClick={goNext}
            disabled={!canGoNext}
          >
            Siguiente
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </Button>
        </div>

        {/* Progress bar when running */}
        {running && status && (
          <div className="mt-3 h-1.5 bg-dark-input rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${status.progress}%`,
                background: 'linear-gradient(90deg, #5E6AD2, #8B93FF)',
              }}
            />
          </div>
        )}
      </div>
      </div>

      {/* Lateral step status */}
      <aside className="w-[188px] shrink-0 border-l border-bdr-subtle bg-dark-surface/80 px-4 py-8">
        <div className="flex h-full flex-col items-center">
          <span className="mb-6 text-[10px] font-bold uppercase tracking-widest text-txt-muted">Estado</span>
          <div className="flex flex-col items-center">
            {STEPS.map((step, idx) => {
              const st = getStepStatus(idx);
              return (
                <div key={step.id} className="flex flex-col items-center">
                  <button
                    onClick={() => setActiveStep(step.id)}
                    className="group flex w-[92px] flex-col items-center gap-2 rounded-card px-2 py-2 transition-all duration-200 hover:bg-dark-elevated"
                    title={step.label}
                  >
                    <div
                      className={`flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold transition-all duration-300 ${
                        st === 'active'
                          ? 'bg-accent text-white shadow-glow ring-4 ring-accent/10'
                          : st === 'completed'
                          ? 'bg-accent-green text-white'
                          : 'bg-dark-elevated text-txt-muted border border-bdr-medium'
                      }`}
                    >
                      {st === 'completed' ? (
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      ) : (
                        idx + 1
                      )}
                    </div>
                    <span
                      className={`max-w-full truncate text-center text-xs font-semibold transition-colors ${
                        st === 'active'
                          ? 'text-txt-primary'
                          : st === 'completed'
                          ? 'text-accent-green'
                          : 'text-txt-muted'
                      }`}
                    >
                      {step.label}
                    </span>
                  </button>
                  {idx < STEPS.length - 1 && (
                    <div
                      className={`my-1 h-10 w-px rounded-full transition-colors ${
                        idx < stepIndex ? 'bg-accent-green' : 'bg-bdr-medium'
                      }`}
                    />
                  )}
                </div>
              );
            })}
          </div>
          <div className="mt-6 w-full space-y-3 border-t border-bdr-subtle pt-5 text-xs">
            <div>
              <span className="block text-[10px] font-bold uppercase tracking-widest text-txt-muted">Imagenes</span>
              <span className="text-txt-primary">{files.length} cargadas</span>
            </div>
            <div>
              <span className="block text-[10px] font-bold uppercase tracking-widest text-txt-muted">Formato</span>
              <span className="text-txt-primary">{formato} · {calidad}%</span>
            </div>
            <div>
              <span className="block text-[10px] font-bold uppercase tracking-widest text-txt-muted">Nombres</span>
              <span className="block truncate text-txt-primary" title={usarRename ? namingExample : 'Sin cambios'}>
                {usarRename ? namingExample : 'Sin cambios'}
              </span>
            </div>
            <div>
              <span className="block text-[10px] font-bold uppercase tracking-widest text-txt-muted">Destino</span>
              <span className={outputReady ? 'text-accent-green' : 'text-accent-yellow'}>
                {outputReady ? 'Destino listo' : 'Destino pendiente'}
              </span>
            </div>
            {!currentStepReady && (
              <div className="rounded-sm border border-accent-yellow/20 bg-accent-yellow/10 px-3 py-2 text-accent-yellow">
                {activeStep === 'files' && 'Agrega al menos una imagen.'}
                {activeStep === 'options' && 'Revisa las opciones de tamano.'}
                {activeStep === 'rename' && 'Completa el patron de nombres.'}
                {activeStep === 'output' && 'Selecciona una carpeta de destino.'}
              </div>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}
