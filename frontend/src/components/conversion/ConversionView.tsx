import { useEffect, useState, useCallback } from 'react';
import { api, onNotify } from '../../api';
import { PreviewItem, ProcessStatus, RenamePattern } from '../../types';
import Dropzone from './Dropzone';
import FileGrid from './FileGrid';
import OptionsCard from './OptionsCard';
import RenameCard from './RenameCard';
import StickyActionBar from './StickyActionBar';
import ProgressBar from './ProgressBar';
import PreviewDrawer from './PreviewDrawer';

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

const parsePositiveInt = (value: string) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const DEFAULT_FORMATS = ['JPEG', 'PNG', 'WEBP', 'TIFF'];
const DEFAULT_FIELDS = ['codigo', 'nombre'];
const DEFAULT_PATTERN = '{codigo}_{nombre}_{seq}{ext}';

const VIDEO_EXTENSIONS = new Set(['.mp4', '.avi', '.mov', '.mkv', '.wmv', '.flv', '.webm', '.m4v', '.3gp', '.mpg', '.mpeg']);
const isVideoByExt = (path: string) => {
  const ext = path.slice(path.lastIndexOf('.')).toLowerCase();
  return VIDEO_EXTENSIONS.has(ext);
};

export default function ConversionView() {

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
  const [namingMode, setNamingMode] = useState<string>('code_name');
  const [formats, setFormats] = useState<string[]>(DEFAULT_FORMATS);
  const [fields, setFields] = useState<string[]>(DEFAULT_FIELDS);
  const [patterns, setPatterns] = useState<RenamePattern[]>([]);
  const [status, setStatus] = useState<ProcessStatus | null>(null);
  const [preview, setPreview] = useState<PreviewItem[] | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [running, setRunning] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [videoFiles, setVideoFiles] = useState<Set<string>>(new Set());

  const namingPresets = patterns.length > 0 ? patterns : buildDefaultPresets(fields);
  const resizeWidth = resizeEnabled ? parsePositiveInt(resizeAncho) : null;
  const resizeHeight = resizeEnabled ? parsePositiveInt(resizeAlto) : null;
  const filesReady = files.length > 0;
  const optionsReady = Boolean(formato) && (!resizeEnabled || (resizeWidth !== null && resizeHeight !== null));
  const renameReady = !usarRename || patron.trim().length > 0;
  const outputReady = destino.trim().length > 0;
  const allReady = filesReady && optionsReady && renameReady && outputReady;

  // History reexecute listener
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
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  // Initial data load
  useEffect(() => {
    api.formats().then((r) => setFormats(r.formats.length ? r.formats : DEFAULT_FORMATS)).catch(() => setFormats(DEFAULT_FORMATS));
    api.getFields().then((r) => {
      const names = r.fields.map((f) => f.name);
      const effectiveNames = names.length ? names : DEFAULT_FIELDS;
      setFields(effectiveNames);
      const defaultPat = effectiveNames.length >= 2 ? `{${effectiveNames[0]}}_${effectiveNames[1]}_{seq}{ext}` : `{${effectiveNames[0]}}_{seq}{ext}`;
      setPatron(defaultPat);
      setNamingMode(effectiveNames.length >= 2 ? 'code_name' : 'code_seq');
    }).catch(() => {
      setFields(DEFAULT_FIELDS);
      setPatron(DEFAULT_PATTERN);
      setNamingMode('code_name');
    });
    api.getRenamePatterns().then((r) => {
      if (r.patterns && r.patterns.length > 0) setPatterns(r.patterns);
    }).catch(() => {});

    // Fetch status once on mount to recover previous state, then rely on push notifications
    pollStatus();
  }, []);

  const pollStatus = async () => {
    try {
      const s = await api.getStatus();
      setStatus(s);
      setRunning(s.running);
    } catch { /* ignore */ }
  };

  // Use push notifications instead of polling — backend sends process.progress and process.complete
  useEffect(() => {
    const unsub = onNotify((method, params) => {
      const p = params as Record<string, unknown>;
      if (method === 'process.progress') {
        setStatus((prev) => prev ? { ...prev, ...p } as ProcessStatus : null);
      } else if (method === 'process.complete') {
        setStatus((prev) => prev ? { ...prev, running: false, progress: 100, ...p } as ProcessStatus : null);
        setRunning(false);
      }
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
    if (!enabled) { setResizeAncho(''); setResizeAlto(''); }
  };

  const clearFiles = () => { setFiles([]); setSelectedFile(null); setSelectedFiles(new Set()); };

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

  // Preview debounce
  useEffect(() => {
    if (!usarRename || !files.length || !patron) { setPreview(null); return; }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const r = await api.preview({ files, patron, secuencia, use_filename_seq: useFilenameSeq });
        if (!cancelled) setPreview(r.preview);
      } catch { if (!cancelled) setPreview(null); }
    }, 250);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [files, patron, secuencia, useFilenameSeq, usarRename]);

  // Detect videos (client-side by extension — no IPC needed)
  useEffect(() => {
    const videoSet = new Set<string>();
    for (const file of files) {
      if (isVideoByExt(file)) videoSet.add(file);
    }
    setVideoFiles(videoSet);
  }, [files]);

  // Sync selectedFiles when files change (remove entries no longer in files)
  useEffect(() => {
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      let changed = false;
      for (const f of next) {
        if (!files.includes(f)) {
          next.delete(f);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [files]);

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
      setSelectedFiles((s) => { const ns = new Set(s); ns.delete(path); return ns; });
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
        if (next.has(path)) next.delete(path); else next.add(path);
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
      setDrawerOpen(true);
    }
  };

  const selectAllFiles = () => {
    if (selectedFiles.size === files.length) setSelectedFiles(new Set());
    else setSelectedFiles(new Set(files));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedFiles.size > 0) {
        e.preventDefault();
        removeSelectedFiles();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedFiles]);

  const videoCount = videoFiles.size;
  const imageCount = files.length - videoCount;
  const summary = files.length > 0
    ? `${imageCount} imagen${imageCount !== 1 ? 'es' : ''}${videoCount > 0 ? ` + ${videoCount} video${videoCount !== 1 ? 's' : ''}` : ''} → ${formato} · ${calidad}% · ${usarRename ? fileNameFromPath(patron) : 'Sin cambios'}`
    : '';

  const isEmpty = files.length === 0;

  return (
    <div
      className={`h-full flex flex-col ${isEmpty ? 'space-y-6' : 'space-y-4'}`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {running && status && <ProgressBar progress={status.progress} />}

      <Dropzone
        dragOver={dragOver}
        onAddFiles={addFiles}
        onAddFolder={addFolder}
        fileCount={files.length - videoFiles.size}
        videoCount={videoFiles.size}
        onClear={clearFiles}
      />

      {isEmpty && (
        <StickyActionBar
          destino={destino}
          onSelectDest={selectDest}
          onStart={doProcess}
          onCancel={doCancel}
          running={running}
          allReady={allReady}
          summary={summary}
        />
      )}

      {!isEmpty && (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 xl:grid-cols-12">
          <div className="flex min-h-0 flex-col gap-4 xl:col-span-7 2xl:col-span-8">
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
              <div className="flex shrink-0 items-center justify-between border-b border-[var(--border-subtle)] px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">Archivos</span>
                  <span className="px-2 py-0.5 rounded-full bg-[var(--bg-elevated)] text-[var(--text-secondary)] text-[11px] font-medium border border-[var(--border-subtle)]">
                    {files.length}
                  </span>
                </div>
                <button
                  onClick={selectAllFiles}
                  className="text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                >
                  {selectedFiles.size === files.length ? 'Deseleccionar todo' : 'Seleccionar todo'}
                </button>
              </div>
              <div className="flex-1 overflow-hidden p-3">
                <FileGrid
                  files={files}
                  selectedFiles={selectedFiles}
                  selectedFile={selectedFile}
                  onFileClick={handleFileClick}
                  onRemoveFile={removeFile}
                  videoFiles={videoFiles}
                />
              </div>
            </div>
          </div>

          <div className="grid min-h-0 content-start gap-4 xl:col-span-5 2xl:col-span-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
                <span className="block text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">Imágenes</span>
                <span className="mt-1 block text-lg font-semibold text-[var(--text-primary)]">{imageCount}</span>
              </div>
              <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
                <span className="block text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">Videos</span>
                <span className="mt-1 block text-lg font-semibold text-[var(--text-primary)]">{videoCount}</span>
              </div>
              <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
                <span className="block text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">Salida</span>
                <span className="mt-1 block truncate text-lg font-semibold text-[var(--text-primary)]">{formato}</span>
              </div>
            </div>

            <OptionsCard
              formato={formato}
              formatos={formats}
              onFormatoChange={setFormato}
              calidad={calidad}
              onCalidadChange={setCalidad}
              resizeEnabled={resizeEnabled}
              onToggleResize={toggleResize}
              resizeAncho={resizeAncho}
              resizeAlto={resizeAlto}
              onResizeAnchoChange={setResizeAncho}
              onResizeAltoChange={setResizeAlto}
              keepExif={keepExif}
              onToggleExif={setKeepExif}
              hasVideos={videoFiles.size > 0}
            />

            <RenameCard
              files={files}
              usarRename={usarRename}
              namingMode={namingMode}
              onNamingModeChange={(mode) => {
                const preset = namingPresets.find((p) => p.id === mode);
                if (preset) chooseNamingPreset(preset);
                else setNamingMode(mode);
              }}
              patron={patron}
              onPatronChange={(p) => { setPatron(p); setNamingMode('custom'); setUsarRename(true); }}
              secuencia={secuencia}
              onSecuenciaChange={setSecuencia}
              useFilenameSeq={useFilenameSeq}
              onToggleFilenameSeq={setUseFilenameSeq}
              namingPresets={namingPresets}
              preview={preview}
              fields={fields}
              onInsertVar={insertVar}
              hasVideos={videoFiles.size > 0}
            />
          </div>
        </div>
      )}

      <PreviewDrawer
        path={drawerOpen ? selectedFile : null}
        formato={formato}
        calidad={calidad}
        resizeAncho={resizeAncho}
        resizeAlto={resizeAlto}
        onClose={() => setDrawerOpen(false)}
      />

      {!isEmpty && (
        <StickyActionBar
          destino={destino}
          onSelectDest={selectDest}
          onStart={doProcess}
          onCancel={doCancel}
          running={running}
          allReady={allReady}
          summary={summary}
        />
      )}
    </div>
  );
}
