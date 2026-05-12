import { useEffect, useState, useCallback, useMemo } from 'react';
import { api } from '../../api';
import { RenamePattern } from '../../types';
import { useFileSelection } from '../../hooks/useFileSelection';
import { useProcessRunner } from '../../hooks/useProcessRunner';
import { buildDefaultPresets, isVideoByExt, DEFAULT_FORMATS, DEFAULT_FIELDS, DEFAULT_PATTERN, parsePositiveInt } from './helpers';
import ConversionPresets, { ConversionConfig } from './ConversionPresets';
import Dropzone from './Dropzone';
import FileGrid from './FileGrid';
import OptionsCard from './OptionsCard';
import RenameCard from './RenameCard';
import ProgressBar from './ProgressBar';
import DatabaseView from '../database/DatabaseView';
import Button from '../ui/Button';
import { Image, Film, FolderOpen, ArrowRight, CheckCircle2, AlertTriangle, AlertCircle, Play, Settings, Square, Tag, Database, ChevronDown } from 'lucide-react';

export default function ConversionView() {
  const [files, setFiles] = useState<string[]>([]);
  const [destino, setDestino] = useState('');
  const [formato, setFormato] = useState('JPEG');
  const [calidad, setCalidad] = useState(95);
  const [conversionEnabled, setConversionEnabled] = useState(true);
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
  const [videoFiles, setVideoFiles] = useState<Set<string>>(new Set());
  const [showDatabase, setShowDatabase] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const { selectedFile, setSelectedFile, selectedFiles, setSelectedFiles, handleFileClick, handleFileDoubleClick, selectAllFiles } = useFileSelection(files);
  const { status, running, pollStatus, startProcess, cancelProcess } = useProcessRunner();

  const namingPresets = useMemo(() => patterns.length > 0 ? patterns : buildDefaultPresets(fields), [patterns, fields]);
  const resizeWidth = resizeEnabled ? parsePositiveInt(resizeAncho) : null;
  const resizeHeight = resizeEnabled ? parsePositiveInt(resizeAlto) : null;
  const filesReady = files.length > 0;
  const optionsReady = !conversionEnabled || (Boolean(formato) && (!resizeEnabled || (resizeWidth !== null && resizeHeight !== null)));
  const renameReady = !usarRename || patron.trim().length > 0;
  const outputReady = destino.trim().length > 0;
  const allReady = filesReady && optionsReady && renameReady && outputReady;

  const currentConfig: ConversionConfig = useMemo(() => ({
    formato, calidad, conversionEnabled, resizeEnabled, resizeAncho, resizeAlto,
    keepExif, usarRename, patron, secuencia, useFilenameSeq, namingMode,
  }), [formato, calidad, conversionEnabled, resizeEnabled, resizeAncho, resizeAlto, keepExif, usarRename, patron, secuencia, useFilenameSeq, namingMode]);

  const handleLoadConfig = useCallback((config: ConversionConfig) => {
    setFormato(config.formato);
    setCalidad(config.calidad);
    setConversionEnabled(config.conversionEnabled ?? true);
    setResizeEnabled(config.resizeEnabled);
    setResizeAncho(config.resizeAncho);
    setResizeAlto(config.resizeAlto);
    setKeepExif(config.keepExif);
    setUsarRename(config.usarRename);
    setPatron(config.patron);
    setSecuencia(config.secuencia);
    setUseFilenameSeq(config.useFilenameSeq);
    setNamingMode(config.namingMode);
  }, []);

  // History reexecute listener
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === 'HISTORY_REEXECUTE') {
        const run = e.data.payload;
        const f = JSON.parse(run.files_json || '[]');
        const options = JSON.parse(run.options_json || '{}');
        setFiles(f);
        setFormato(options.formato || 'JPEG');
        setCalidad(options.calidad || 95);
        setConversionEnabled(options.conversion_enabled !== false);
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
    let cancelled = false;
    api.formats().then((r) => { if (!cancelled) setFormats(r.formats.length ? r.formats : DEFAULT_FORMATS); }).catch(() => { if (!cancelled) setFormats(DEFAULT_FORMATS); });
    api.getFields().then((r) => {
      if (cancelled) return;
      const names = r.fields.map((f) => f.name);
      const effectiveNames = names.length ? names : DEFAULT_FIELDS;
      setFields(effectiveNames);
      const defaultPat = effectiveNames.length >= 2 ? `{${effectiveNames[0]}}_${effectiveNames[1]}_{seq}{ext}` : `{${effectiveNames[0]}}_{seq}{ext}`;
      setPatron(defaultPat);
      setNamingMode(effectiveNames.length >= 2 ? 'code_name' : 'code_seq');
    }).catch(() => {
      if (cancelled) return;
      setFields(DEFAULT_FIELDS);
      setPatron(DEFAULT_PATTERN);
      setNamingMode('code_name');
    });
    api.getRenamePatterns().then((r) => {
      if (!cancelled && r.patterns && r.patterns.length > 0) setPatterns(r.patterns);
    }).catch(() => {});
    pollStatus();
    return () => { cancelled = true; };
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
  };

  // Detect videos
  useEffect(() => {
    const videoSet = new Set<string>();
    for (const file of files) {
      if (isVideoByExt(file)) videoSet.add(file);
    }
    setVideoFiles(videoSet);
  }, [files]);

  const doProcess = async () => {
    if (!allReady) return;
    await startProcess({
      files, destino, formato, calidad,
      conversion_enabled: conversionEnabled,
      resize_ancho: resizeAncho ? parseInt(resizeAncho) : null,
      resize_alto: resizeAlto ? parseInt(resizeAlto) : null,
      keep_exif: keepExif, usar_rename: usarRename, patron, secuencia,
      use_filename_seq: useFilenameSeq,
    });
  };

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

  const onDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); setDragOver(true); }, []);
  const onDragLeave = useCallback((e: React.DragEvent) => { e.preventDefault(); setDragOver(false); }, []);
  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const dropped = Array.from(e.dataTransfer.files).map((f: any) => f.path || f.name);
    mergeFiles(dropped);
  }, [mergeFiles]);

  const onPasteFiles = useCallback((paths: string[]) => { mergeFiles(paths); }, [mergeFiles]);

  const videoCount = videoFiles.size;
  const imageCount = files.length - videoCount;
  const isEmpty = files.length === 0;
  const destinoLabel = destino
    ? destino.split(/[\\/]/).pop() || destino
    : 'Seleccionar carpeta de destino…';

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
        onPasteFiles={onPasteFiles}
        centerControls={!isEmpty ? (
          <div className="flex w-full min-w-0 items-center gap-3">
            <ConversionPresets currentConfig={currentConfig} onLoadConfig={handleLoadConfig} className="hidden sm:block shrink-0" />
            <button
              onClick={selectDest}
              className={`flex h-11 w-[280px] max-w-[32vw] shrink-0 items-center gap-2.5 rounded-xl border px-3 text-left transition-all group ${
                destino
                  ? 'bg-[var(--bg-elevated)] border-[var(--border-subtle)] hover:border-[var(--border-medium)]'
                  : 'bg-[var(--accent-yellow)]/5 border-[var(--accent-yellow)]/30 hover:border-[var(--accent-yellow)]/50'
              }`}
            >
              <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors ${
                destino ? 'bg-[var(--bg-base)] text-[var(--text-muted)] group-hover:text-[var(--accent-primary)]' : 'bg-[var(--accent-yellow)]/10 text-[var(--accent-yellow)]'
              }`}>
                <FolderOpen className="h-3.5 w-3.5" />
              </div>
              <div className="flex min-w-0 flex-col">
                <span className="text-[10px] font-medium leading-3 text-[var(--text-muted)]">Destino</span>
                <span className={`truncate text-xs leading-4 ${destino ? 'font-medium text-[var(--text-primary)]' : 'text-[var(--accent-yellow)]'}`}>
                  {destinoLabel}
                </span>
              </div>
              {!destino && <AlertCircle className="ml-auto h-3.5 w-3.5 shrink-0 text-[var(--accent-yellow)]" />}
            </button>
            <div className="hidden shrink-0 items-center gap-2 xl:flex">
              <div className="flex items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2">
                <Image className="h-3.5 w-3.5 text-[var(--text-muted)]" />
                <span className="text-xs font-bold text-[var(--text-primary)]">{imageCount}</span>
                <span className="text-xs text-[var(--text-muted)]">img</span>
                {videoCount > 0 && (
                  <>
                    <span className="text-[var(--border-medium)]">|</span>
                    <span className="text-xs font-bold text-[var(--text-primary)]">{videoCount}</span>
                    <span className="text-xs text-[var(--text-muted)]">vid</span>
                  </>
                )}
              </div>
              <div className="flex items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2">
                <Settings className="h-3.5 w-3.5 text-[var(--text-muted)]" />
                <span className="text-xs font-bold text-[var(--text-primary)]">{conversionEnabled ? formato : 'Original'}</span>
                {conversionEnabled && (
                  <>
                    <span className="text-xs text-[var(--text-muted)]">·</span>
                    <span className="text-xs text-[var(--text-muted)]">{calidad}%</span>
                  </>
                )}
                {conversionEnabled && resizeEnabled && <span className="text-[10px] font-medium text-[var(--accent-primary)]">R</span>}
                {usarRename && <Tag className="h-3 w-3 text-[var(--accent-secondary)]" />}
              </div>
            </div>
          </div>
        ) : undefined}
        conversionAction={!isEmpty ? (
          !running ? (
            <Button variant="primary" size="sm" onClick={doProcess} disabled={!allReady}>
              <Play className="h-3.5 w-3.5 fill-current" />
              {conversionEnabled ? 'Iniciar conversión' : 'Iniciar renombrado'}
              <ArrowRight className="h-3.5 w-3.5 opacity-60" />
            </Button>
          ) : (
            <Button variant="danger" size="sm" onClick={cancelProcess}>
              <Square className="h-3.5 w-3.5 fill-current" />
              Detener
            </Button>
          )
        ) : undefined}
      />

      {/* Main Content */}
      {!isEmpty && (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 xl:grid-cols-12">
          {/* Left Column: Files */}
          <div className="flex min-h-0 flex-col gap-4 xl:col-span-7 2xl:col-span-8">
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
              {/* Files Header */}
              <div className="flex shrink-0 items-center justify-between border-b border-[var(--border-subtle)] px-5 py-3.5">
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    <Image className="h-4 w-4 text-[var(--text-muted)]" />
                    <span className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">Archivos</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="px-2.5 py-0.5 rounded-full bg-[var(--bg-elevated)] text-[var(--text-secondary)] text-[11px] font-semibold border border-[var(--border-subtle)]">
                      {files.length}
                    </span>
                    {videoCount > 0 && (
                      <span className="px-2 py-0.5 rounded-full bg-[var(--accent-yellow)]/10 text-[var(--accent-yellow)] text-[10px] font-semibold border border-[var(--accent-yellow)]/20 flex items-center gap-1">
                        <Film className="h-2.5 w-2.5" />
                        {videoCount}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {selectedFiles.size > 0 && (
                    <button
                      onClick={removeSelectedFiles}
                      className="text-[11px] font-medium text-[var(--accent-red)] hover:bg-[var(--accent-red)]/10 px-2.5 py-1 rounded-lg transition-colors"
                    >
                      Eliminar {selectedFiles.size}
                    </button>
                  )}
                  <button
                    onClick={selectAllFiles}
                    className="text-[11px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] px-2.5 py-1 rounded-lg hover:bg-[var(--bg-elevated)] transition-colors"
                  >
                    {selectedFiles.size === files.length ? 'Deseleccionar todo' : 'Seleccionar todo'}
                  </button>
                </div>
              </div>

              {/* File Grid */}
              <div className="flex-1 overflow-hidden p-4">
                <FileGrid
                  files={files}
                  selectedFiles={selectedFiles}
                  selectedFile={selectedFile}
                  onFileClick={handleFileClick}
                  onFileDoubleClick={handleFileDoubleClick}
                  onRemoveFile={removeFile}
                  videoFiles={videoFiles}
                />
              </div>

              {/* File Grid Footer */}
              <div className="shrink-0 flex items-center justify-between border-t border-[var(--border-subtle)] px-5 py-2.5 bg-[var(--bg-elevated)]/30">
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
                    <Image className="h-3 w-3" />
                    <span className="font-semibold text-[var(--text-primary)]">{imageCount}</span>
                    <span>imagen{imageCount !== 1 ? 'es' : ''}</span>
                  </div>
                  {videoCount > 0 && (
                    <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
                      <Film className="h-3 w-3" />
                      <span className="font-semibold text-[var(--text-primary)]">{videoCount}</span>
                      <span>video{videoCount !== 1 ? 's' : ''}</span>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-3 text-[11px]">
                  <span className="hidden text-[var(--text-muted)] sm:inline">Click para seleccionar</span>
                  {selectedFiles.size > 0 && (
                    <span className="text-[var(--accent-primary)] font-medium">
                      {selectedFiles.size} seleccionado{selectedFiles.size !== 1 ? 's' : ''}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: Options */}
          <div className="grid min-h-0 content-start gap-4 xl:col-span-5 2xl:col-span-4 overflow-y-auto pr-1">
            {/* Status indicators */}
            <div className="flex items-center gap-2">
              <div className={`flex-1 flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-medium transition-colors ${
                optionsReady
                  ? 'bg-[var(--accent-green)]/5 border-[var(--accent-green)]/20 text-[var(--accent-green)]'
                  : 'bg-[var(--bg-surface)] border-[var(--border-subtle)] text-[var(--text-muted)]'
              }`}>
                {optionsReady ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
                <span>Opciones</span>
                <ArrowRight className="h-3 w-3 ml-auto opacity-60" />
              </div>
              <div className={`flex-1 flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-medium transition-colors ${
                renameReady
                  ? 'bg-[var(--accent-green)]/5 border-[var(--accent-green)]/20 text-[var(--accent-green)]'
                  : 'bg-[var(--bg-surface)] border-[var(--border-subtle)] text-[var(--text-muted)]'
              }`}>
                {renameReady ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
                <span>Nombres</span>
                <ArrowRight className="h-3 w-3 ml-auto opacity-60" />
              </div>
              <div className={`flex-1 flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-medium transition-colors ${
                outputReady
                  ? 'bg-[var(--accent-green)]/5 border-[var(--accent-green)]/20 text-[var(--accent-green)]'
                  : 'bg-[var(--bg-surface)] border-[var(--border-subtle)] text-[var(--text-muted)]'
              }`}>
                {outputReady ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
                <span>Destino</span>
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
              conversionEnabled={conversionEnabled}
              onToggleConversion={setConversionEnabled}
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
              fields={fields}
              onInsertVar={insertVar}
              hasVideos={videoFiles.size > 0}
            />
          </div>
        </div>
      )}

      {/* Database section */}
      <div className="border-t border-[var(--border-subtle)] pt-4">
        <button
          onClick={() => setShowDatabase(!showDatabase)}
          className="flex w-full items-center gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-3 text-left transition-colors hover:bg-[var(--bg-elevated)]"
        >
          <Database className="h-4 w-4 text-[var(--text-muted)]" />
          <span className="text-sm font-medium text-[var(--text-primary)]">Base de Datos</span>
          <span className="ml-auto text-[var(--text-muted)] transition-transform duration-200" style={{ transform: showDatabase ? 'rotate(180deg)' : 'rotate(0deg)' }}>
            <ChevronDown className="h-4 w-4" />
          </span>
        </button>
        {showDatabase && (
          <div className="mt-2 h-[420px] overflow-hidden rounded-xl border border-[var(--border-subtle)]">
            <DatabaseView />
          </div>
        )}
      </div>
    </div>
  );
}
