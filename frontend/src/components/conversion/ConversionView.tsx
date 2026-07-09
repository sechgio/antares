import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { api } from '../../api';
import { useFileSelection } from '../../hooks/useFileSelection';
import { useProcessRunner } from '../../hooks/useProcessRunner';
import { useToast } from '../../hooks/useToast';
import { useDialog } from '../../hooks/useDialog';
import { RenamePattern, DBRecord, PreviewItem } from '../../types';
import { buildDefaultPresets, computeMappingStats, isMappingSchemaMismatch, isVideoByExt, DEFAULT_FORMATS, DEFAULT_FIELDS, DEFAULT_PATTERN, parsePositiveInt, pickSyncedKeyColumn, type RenameSource } from './helpers';
import ConversionPresets, { ConversionConfig } from './ConversionPresets';
import Dropzone from './Dropzone';
import FileGrid from './FileGrid';
import OptionsCard from './OptionsCard';
import RenameCard from './RenameCard';
import SegmentedProgressBar from './SegmentedProgressBar';
import Button from '../ui/Button';
import { Image, Film, FolderOpen, ArrowRight, CheckCircle2, AlertTriangle, AlertCircle, Play, Square } from 'lucide-react';
import {
  subscribeHistoryReexecute,
  takePendingHistoryReexecute,
} from '../history/historyEvents';
import type { HistoryRun } from '../history/RunList';

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
  const [wordSeparator, setWordSeparator] = useState('_');
  const [secuencia, setSecuencia] = useState(1);
  const [useFilenameSeq, setUseFilenameSeq] = useState(true);
  const [namingMode, setNamingMode] = useState<string>('code_name');
  const [formats, setFormats] = useState<string[]>(DEFAULT_FORMATS);
  const [fields, setFields] = useState<string[]>(DEFAULT_FIELDS);
  const [patterns, setPatterns] = useState<RenamePattern[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [dbColumns, setDbColumns] = useState<string[]>([]);
  const [dbRecords, setDbRecords] = useState<DBRecord[]>([]);
  const [keyColumn, setKeyColumn] = useState('');
  const [renameSource, setRenameSource] = useState<RenameSource>('none');
  const [mappingData, setMappingData] = useState<Record<string, string> | null>(null);
  const [mappingPath, setMappingPath] = useState<string | null>(null);
  const [mappingIdColumn, setMappingIdColumn] = useState('');
  const [mappingRenameColumn, setMappingRenameColumn] = useState('');
  const [mappingColumns, setMappingColumns] = useState<string[]>([]);
  const [renamePreview, setRenamePreview] = useState<PreviewItem[]>([]);

  const mappingMode = renameSource === 'mapping';
  const mappingResult = useMemo(
    () => (mappingData ? computeMappingStats(mappingData, files) : null),
    [mappingData, files],
  );
  const { selectedFile, setSelectedFile, selectedFiles, setSelectedFiles, handleFileClick, handleFileDoubleClick, selectAllFiles } = useFileSelection(files);
  const { status, running, pollStatus, startProcess, cancelProcess } = useProcessRunner();
  const { addToast } = useToast();
  const { confirm } = useDialog();

  const namingPresets = useMemo(() => {
    return patterns.length > 0 ? patterns : buildDefaultPresets(fields);
  }, [patterns, fields]);
  const resizeWidth = resizeEnabled ? parsePositiveInt(resizeAncho) : null;
  const resizeHeight = resizeEnabled ? parsePositiveInt(resizeAlto) : null;
  const filesReady = files.length > 0;
  const optionsReady = !conversionEnabled || (Boolean(formato) && (!resizeEnabled || (resizeWidth !== null && resizeHeight !== null)));
  const renameReady = !usarRename || mappingMode || patron.trim().length > 0;
  const keyColumnReady = !usarRename || mappingMode || dbColumns.length === 0 || (Boolean(keyColumn) && dbColumns.includes(keyColumn));
  const noMappingCollisions = !mappingMode || (mappingResult?.collisions.length ?? 0) === 0;
  const outputReady = destino.trim().length > 0;
  const allReady = filesReady && optionsReady && renameReady && keyColumnReady && noMappingCollisions && outputReady;

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

  const applyHistoryRun = useCallback((run: HistoryRun) => {
    if (!run || typeof run !== 'object') return;

    void (async () => {
      let f: string[] = [];
      let options: Record<string, unknown> = {};
      try {
        f = JSON.parse(run.files_json || '[]') as string[];
      } catch { /* keep default */ }
      try {
        options = JSON.parse(run.options_json || '{}') as Record<string, unknown>;
      } catch { /* keep default */ }

      setFiles(f);
      setFormato((options.formato as string) || 'JPEG');
      // Use nullish coalescing so calidad=0 is preserved if ever stored.
      setCalidad(typeof options.calidad === 'number' ? options.calidad : 95);
      setConversionEnabled(options.conversion_enabled !== false);
      setKeepExif(Boolean(options.keep_exif));

      if (typeof options.destino === 'string' && options.destino.trim()) {
        setDestino(options.destino);
      }
      if (typeof options.secuencia === 'number' && Number.isFinite(options.secuencia)) {
        setSecuencia(Math.max(1, Math.floor(options.secuencia)));
      } else if (typeof options.secuencia === 'string' && options.secuencia.trim()) {
        const n = Number.parseInt(options.secuencia, 10);
        if (Number.isFinite(n)) setSecuencia(Math.max(1, n));
      }
      if (typeof options.word_separator === 'string') {
        setWordSeparator(options.word_separator);
      }
      if (typeof options.use_filename_seq === 'boolean') {
        setUseFilenameSeq(options.use_filename_seq);
      } else if (options.sequence_mode === 'global') {
        setUseFilenameSeq(false);
      } else if (options.sequence_mode === 'record' || options.sequence_mode === 'filename') {
        setUseFilenameSeq(true);
      }

      const applyResize = () => {
        if (!options.resize) return;
        const parts = String(options.resize).replace(/[()[\]]/g, '').split(',');
        if (parts.length === 2) {
          setResizeAncho(parts[0].trim());
          setResizeAlto(parts[1].trim());
          setResizeEnabled(true);
        }
      };

      const isMappingRun = options.mapping_mode === true || options.rename_source === 'mapping';
      const savedMappingPath = typeof options.mapping_path === 'string' ? options.mapping_path : '';

      if (isMappingRun && savedMappingPath) {
        try {
          const savedIdColumn = typeof options.id_column === 'string' ? options.id_column : '';
          const savedRenameColumn = typeof options.rename_column === 'string' ? options.rename_column : '';
          const result = await api.dbParseMapping(savedMappingPath, f, savedIdColumn, savedRenameColumn);
          setMappingPath(savedMappingPath);
          setMappingData(result.mapping);
          setMappingColumns(result.columns ?? []);
          setMappingIdColumn(result.id_column ?? savedIdColumn);
          setMappingRenameColumn(result.rename_column ?? savedRenameColumn);
          setRenameSource('mapping');
          setPatron('{renombre}{ext}');
          setUsarRename(true);
          setNamingMode('custom');
          applyResize();
          return;
        } catch {
          addToast({
            message: 'No se pudo restaurar el mapeo desde el historial. Vuelve a cargar el Excel de mapeo.',
            type: 'error',
          });
        }
      }

      setMappingData(null);
      setMappingPath(null);
      setPatron(run.patron || '');
      setUsarRename(options.usar_rename !== false && Boolean(run.patron));
      setNamingMode(options.usar_rename === false ? 'keep' : 'custom');
      setRenameSource(options.rename_source === 'catalog' ? 'catalog' : 'none');
      if (typeof options.key_column === 'string' && options.key_column) {
        setKeyColumn(options.key_column);
      }
      applyResize();
    })();
  }, [addToast]);

  useEffect(() => {
    // Consume payload buffered while ConversionView was unmounted (other tab).
    const pending = takePendingHistoryReexecute();
    if (pending) applyHistoryRun(pending);

    return subscribeHistoryReexecute((run) => {
      // Live event while mounted: drop buffer so remount does not re-apply.
      takePendingHistoryReexecute();
      applyHistoryRun(run);
    });
  }, [applyHistoryRun]);

  useEffect(() => {
    let cancelled = false;

    Promise.allSettled([
      api.formats(),
      api.getFields(),
      api.getRenamePatterns(),
      api.getDbColumns(),
    ]).then(([fmtResult, fieldsResult, patternsResult, dbColumnsResult]) => {
      if (cancelled) return;

      if (fmtResult.status === 'fulfilled') {
        const r = fmtResult.value;
        setFormats(r.formats.length ? r.formats : DEFAULT_FORMATS);
      } else {
        setFormats(DEFAULT_FORMATS);
      }

      if (fieldsResult.status === 'fulfilled') {
        const r = fieldsResult.value;
        const names = r.fields.map((f) => f.name);
        const effectiveNames = names.length ? names : DEFAULT_FIELDS;
        setFields(effectiveNames);
        const defaultPat = effectiveNames.length >= 2 ? `{${effectiveNames[0]}}_${effectiveNames[1]}_{seq}{ext}` : `{${effectiveNames[0]}}_{seq}{ext}`;
        setPatron(defaultPat);
        setNamingMode(effectiveNames.length >= 2 ? 'code_name' : 'code_seq');
      } else {
        setFields(DEFAULT_FIELDS);
        setPatron(DEFAULT_PATTERN);
        setNamingMode('code_name');
      }

      if (patternsResult.status === 'fulfilled') {
        const r = patternsResult.value;
        if (r.patterns && r.patterns.length > 0) setPatterns(r.patterns);
      }

      if (dbColumnsResult.status === 'fulfilled') {
        const r = dbColumnsResult.value;
        const columns = r.columns ?? [];
        setDbColumns(columns);
        setDbRecords(r.records ?? []);
        if (columns.length > 0) {
          setRenameSource('catalog');
          setFields(columns);
        }
        setKeyColumn((prev) => pickSyncedKeyColumn(prev, columns));
      }
    });

    pollStatus();
    return () => { cancelled = true; };
  }, []);

  const mergeFiles = useCallback((incoming: string[]) => {
    if (!incoming.length) return;
    // For large incoming batches, avoid the O(n) Set scan of the entire
    // existing list by using a Set for dedup and converting back to array.
    setFiles((prev) => {
      if (prev.length === 0) return incoming;
      const existing = new Set(prev);
      const newItems = incoming.filter((f) => !existing.has(f));
      return newItems.length ? [...prev, ...newItems] : prev;
    });
    setSelectedFile((prev) => prev || incoming[0]);
  }, []);

  const addFiles = async () => {
    const r = await api.dialogFiles();
    mergeFiles(r.paths);
  };

  const clearMapping = useCallback(() => {
    setMappingData(null);
    setMappingPath(null);
    setMappingColumns([]);
    setMappingIdColumn('');
    setMappingRenameColumn('');
    setRenameSource(dbColumns.length > 0 ? 'catalog' : 'none');
    setRenamePreview([]);
  }, [dbColumns.length]);

  // B-06: reload the mapping Excel with new column choices, guarded by a
  // cancellation token so rapid selector changes can't overwrite each other.
  const mappingReloadToken = useRef(0);
  const reloadMappingWithColumns = useCallback(
    async (idColumn: string, renameColumn: string) => {
      if (!mappingPath || !idColumn || !renameColumn) return;
      const token = ++mappingReloadToken.current;
      try {
        const result = await api.dbParseMapping(mappingPath, files, idColumn, renameColumn);
        if (token !== mappingReloadToken.current) return; // a newer change superseded us
        setMappingData(result.mapping);
        setMappingColumns(result.columns ?? []);
        setMappingIdColumn(result.id_column ?? idColumn);
        setMappingRenameColumn(result.rename_column ?? renameColumn);
      } catch (err) {
        if (token !== mappingReloadToken.current) return;
        addToast({ message: err instanceof Error ? err.message : String(err), type: 'error' });
      }
    },
    [mappingPath, files, addToast],
  );

  const importDatabaseExcel = async (excelPath: string) => {
    if (dbColumns.length > 0 || dbRecords.length > 0 || mappingMode) {
      const proceed = await confirm({
        title: 'Reemplazar base de datos',
        description: mappingMode
          ? 'La importación reemplazará el mapeo activo y cargará el Excel al catálogo SQLite.'
          : 'La importación reemplazará las columnas configuradas y todos los registros actuales con los datos del Excel seleccionado.',
        type: 'destructive',
        confirmLabel: 'Importar',
      });
      if (!proceed) return;
    }
    // Detect mapping Excel (ID + RENOMBRE columns) before falling back to catalog import.
    if (files.length > 0) {
      try {
        const result = await api.dbParseMapping(excelPath, files);
        if (result.mapping && Object.keys(result.mapping).length > 0) {
          clearMapping();
          setMappingPath(excelPath);
          setMappingData(result.mapping);
          setMappingColumns(result.columns ?? []);
          setMappingIdColumn(result.id_column ?? '');
          setMappingRenameColumn(result.rename_column ?? '');
          setRenameSource('mapping');
          setPatron('{renombre}{ext}');
          setUsarRename(true);
          setNamingMode('custom');
          addToast({ message: `Mapeo cargado: ${Object.keys(result.mapping).length} entradas`, type: 'success' });
          return;
        }
      } catch (err) {
        if (!isMappingSchemaMismatch(err)) {
          const msg = err instanceof Error ? err.message : String(err);
          addToast({ message: `Error importando Excel: ${msg}`, type: 'error' });
          return;
        }
        // Schema mismatch → not a mapping Excel, fall through to catalog import.
      }
    }
    try {
      const result = await api.importExcel(excelPath);
      clearMapping();
      await loadDbColumns();
      setRenameSource('catalog');
      addToast({ message: `Base de datos importada: ${result.imported} registros`, type: 'success' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addToast({ message: `Error importando Excel: ${msg}`, type: 'error' });
    }
  };

  const sequenceMode = useFilenameSeq ? 'record' : 'global';

  // Preview debounce: increased to 600ms and guarded by a cancellation token
  // so rapid file additions don't stack multiple backend calls.
  const previewToken = useRef(0);
  useEffect(() => {
    if (!usarRename || files.length === 0) {
      setRenamePreview([]);
      return undefined;
    }

    const token = ++previewToken.current;
    // For very large file lists, sample the first 200 files for the preview
    // to avoid sending a massive payload to the backend on every keystroke.
    const PREVIEW_SAMPLE_LIMIT = 200;
    const previewFiles = files.length > PREVIEW_SAMPLE_LIMIT ? files.slice(0, PREVIEW_SAMPLE_LIMIT) : files;

    const timer = window.setTimeout(async () => {
      try {
        const result = await api.preview(
          mappingMode && mappingData
            ? {
                files: previewFiles,
                patron: '{renombre}{ext}',
                secuencia: 1,
                use_filename_seq: false,
                mapping: mappingData,
              }
            : {
                files: previewFiles,
                patron,
                secuencia,
                use_filename_seq: useFilenameSeq,
                key_column: keyColumn || undefined,
                word_separator: wordSeparator,
                sequence_mode: sequenceMode,
              },
        );
        if (token !== previewToken.current) return; // a newer change superseded us
        setRenamePreview(result.preview);
      } catch {
        if (token !== previewToken.current) return;
        setRenamePreview([]);
      }
    }, 600);

    return () => window.clearTimeout(timer);
  }, [files, usarRename, mappingMode, mappingData, patron, secuencia, useFilenameSeq, keyColumn, wordSeparator, sequenceMode]);

  // Auto-detect the best key column when files are added and a DB is loaded.
  // This fixes the common case where the default key column (first column)
  // doesn't contain the file codes, causing silent rename failures.
  // Only sends a sample of files to avoid large IPC payloads.
  const keyDetectToken = useRef(0);
  useEffect(() => {
    if (mappingMode || files.length === 0 || dbColumns.length <= 1) return;
    const token = ++keyDetectToken.current;
    // The backend only samples the first 50 files anyway, so we can send
    // a small sample instead of the full array to reduce IPC payload size.
    const sampleFiles = files.length > 50 ? files.slice(0, 50) : files;
    const timer = window.setTimeout(async () => {
      try {
        const result = await api.dbDetectKeyColumn(sampleFiles);
        if (token !== keyDetectToken.current) return;
        if (result.key_column && result.matches > 0 && result.key_column !== keyColumn) {
          setKeyColumn(result.key_column);
        }
      } catch {
        // ignore — keep the default key column
      }
    }, 800);
    return () => window.clearTimeout(timer);
  }, [files, dbColumns, mappingMode, keyColumn]);

  const loadDbColumns = async () => {
    try {
      const result = await api.getDbColumns();
      const columns = result.columns ?? [];
      setDbColumns(columns);
      setDbRecords(result.records);
      if (columns.length > 0) setFields(columns);
      setKeyColumn((prev) => pickSyncedKeyColumn(prev, columns));
    } catch (err) {
      console.error('Error loading DB columns:', err);
    }
  };

  const addFolder = useCallback((paths: string[]) => mergeFiles(paths), [mergeFiles]);

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

  // Compute video files via useMemo instead of useEffect+setState.
  // This avoids an extra render cycle and keeps videoFiles stable when
  // files hasn't changed.
  const videoFiles = useMemo(() => {
    const videoSet = new Set<string>();
    for (const file of files) {
      if (isVideoByExt(file)) videoSet.add(file);
    }
    return videoSet;
  }, [files]);

  const doProcess = async () => {
    if (!allReady || running) return;
    await startProcess({
      files, destino, formato, calidad,
      conversion_enabled: conversionEnabled,
      resize_ancho: parsePositiveInt(resizeAncho),
      resize_alto: parsePositiveInt(resizeAlto),
      keep_exif: keepExif, usar_rename: usarRename, patron, secuencia,
      word_separator: wordSeparator,
      use_filename_seq: useFilenameSeq,
      key_column: mappingMode ? undefined : (keyColumn || undefined),
      mapping_path: mappingMode && mappingPath ? mappingPath : undefined,
      mapping: mappingMode && !mappingPath ? mappingData ?? undefined : undefined,
      id_column: mappingMode ? mappingIdColumn || undefined : undefined,
      rename_column: mappingMode ? mappingRenameColumn || undefined : undefined,
      sequence_mode: sequenceMode,
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
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      if (selectedFiles.size === 0) return;
      // Don't hijack Backspace/Delete while the user is editing a text field,
      // a textarea, a select, or any contentEditable — otherwise fixing a typo
      // in the rename pattern / resize fields silently deletes the selected files.
      const t = e.target as HTMLElement | null;
      if (
        t instanceof HTMLInputElement ||
        t instanceof HTMLTextAreaElement ||
        t instanceof HTMLSelectElement ||
        t?.isContentEditable
      ) {
        return;
      }
      e.preventDefault();
      removeSelectedFiles();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedFiles]);

  const onDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); setDragOver(true); }, []);
  const onDragLeave = useCallback((e: React.DragEvent) => { e.preventDefault(); setDragOver(false); }, []);
  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    // Electron 32+ removed File.path; resolve via the webUtils bridge.
    const dropped = Array.from(e.dataTransfer.files)
      .map((f) => window.electronAPI?.getPathForFile(f) ?? '')
      .filter((p) => p.length > 0);
    if (dropped.length) mergeFiles(dropped);
  }, [mergeFiles]);

  const onPasteFiles = useCallback((paths: string[]) => { mergeFiles(paths); }, [mergeFiles]);

  const videoCount = videoFiles.size;
  const imageCount = files.length - videoCount;
  const isEmpty = files.length === 0;
  const destinoLabel = destino
    ? destino.split(/[\\/]/).pop() || destino
    : 'carpeta de destino';
  const progressTotal = status?.total ?? files.length;
  const progressCompleted = (status?.ok_count ?? 0) + (status?.err_count ?? 0);

  return (
    <div
      className="flex h-full flex-col gap-4"
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className={isEmpty ? 'flex min-h-0 w-full flex-1' : undefined}>
        <Dropzone
        dragOver={dragOver}
        onAddFiles={addFiles}
        onAddFolderPaths={addFolder}
        onImportDatabase={importDatabaseExcel}
        fileCount={files.length - videoFiles.size}
        videoCount={videoFiles.size}
        onClear={clearFiles}
        onPasteFiles={onPasteFiles}
        centerControls={!isEmpty ? (
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <ConversionPresets currentConfig={currentConfig} onLoadConfig={handleLoadConfig} className="hidden sm:block shrink-0" />
            <button
              onClick={selectDest}
              className="inline-flex min-w-0 max-w-[min(280px,100%)] items-center gap-2 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-4 py-2 text-sm font-medium text-[var(--text-secondary)] transition-all hover:border-[var(--border-medium)] hover:text-[var(--text-primary)] group"
            >
              <FolderOpen className="h-4 w-4 shrink-0 text-[var(--text-muted)] group-hover:text-[var(--accent-primary)] transition-colors" />
              <span className="min-w-0 truncate">
                {destino ? destinoLabel : 'carpeta de destino'}
              </span>
              {!destino && <AlertCircle className="h-3.5 w-3.5 shrink-0 text-[var(--accent-yellow)]" />}
            </button>
          </div>
        ) : undefined}
        conversionAction={!isEmpty ? (
          !running ? (
            <Button variant="primary" size="md" className="px-4" onClick={doProcess} disabled={!allReady}>
              <Play className="h-4 w-4 fill-current" />
              {conversionEnabled ? 'Iniciar conversión' : 'Iniciar renombrado'}
              <ArrowRight className="h-4 w-4 opacity-60" />
            </Button>
          ) : (
            <Button variant="danger" size="md" className="px-4" onClick={cancelProcess}>
              <Square className="h-4 w-4 fill-current" />
              Detener
            </Button>
          )
        ) : undefined}
        progressIndicator={
          running && status ? (
            <SegmentedProgressBar
              progress={status.progress}
              completed={progressCompleted}
              total={Math.max(progressTotal, 1)}
            />
          ) : undefined
        }
        />
      </div>

      {!isEmpty && (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 xl:grid-cols-12">
          <div className="flex min-h-0 flex-col gap-4 xl:col-span-7 2xl:col-span-8">
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
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

              <div className="min-h-0 flex-1 overflow-hidden p-4">
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

              <div className="shrink-0 flex items-center justify-between border-t border-[var(--border-subtle)] px-5 py-2 bg-[var(--bg-elevated)]/30">
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

          <div className="grid min-h-0 content-start gap-4 xl:col-span-5 2xl:col-span-4 overflow-y-auto pr-1">
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
              mappingMode={mappingMode}
              mappingResult={mappingResult}
              mappingColumns={mappingColumns}
              mappingIdColumn={mappingIdColumn}
              mappingRenameColumn={mappingRenameColumn}
              renamePreview={renamePreview}
              onClearMapping={clearMapping}
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
              dbColumns={dbColumns}
              dbRecords={dbRecords}
              onInsertVar={insertVar}
              hasVideos={videoFiles.size > 0}
              keyColumn={keyColumn}
              onKeyColumnChange={(col) => { setKeyColumn(col); if (col) setUsarRename(true); }}
              onMappingIdColumnChange={(col) => {
                setMappingIdColumn(col);
                reloadMappingWithColumns(col, mappingRenameColumn);
              }}
              onMappingRenameColumnChange={(col) => {
                setMappingRenameColumn(col);
                reloadMappingWithColumns(mappingIdColumn, col);
              }}
              wordSeparator={wordSeparator}
              onWordSeparatorChange={setWordSeparator}
            />
          </div>
        </div>
      )}
    </div>
  );
}
