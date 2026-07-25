import { useState, useEffect, useCallback, type ReactNode } from 'react';
import Button from '../ui/Button';
import { api } from '../../api';
import { registerLocalPaths } from '../../utils/registerLocalPath';
import { Folder, Plus, RotateCcw, UploadCloud, FileImage, Film, Database } from 'lucide-react';

interface DropzoneProps {
  dragOver: boolean;
  onAddFiles: () => void;
  onAddFolderPaths: (paths: string[]) => void;
  onImportDatabase?: (excelPath: string) => void;
  fileCount?: number;
  onClear?: () => void;
  videoCount?: number;
  onPasteFiles?: (files: string[]) => void;
  centerControls?: ReactNode;
  conversionAction?: ReactNode;
  progressIndicator?: ReactNode;
}

export default function Dropzone({
  dragOver,
  onAddFiles,
  onAddFolderPaths,
  onImportDatabase,
  fileCount = 0,
  onClear,
  videoCount = 0,
  onPasteFiles,
  centerControls,
  conversionAction,
  progressIndicator,
}: DropzoneProps) {
  const totalCount = fileCount + videoCount;
  const [pasting, setPasting] = useState(false);

  const SUPPORTED_IMAGE_FORMATS = ['JPG', 'JPEG', 'PNG', 'WEBP', 'TIFF', 'BMP', 'GIF', 'ICO', 'PDF'];
  const SUPPORTED_VIDEO_FORMATS = ['MP4', 'AVI', 'MOV', 'MKV', 'WMV', 'FLV', 'WEBM', 'M4V', '3GP', 'MPG', 'MPEG'];

  const openFolderPicker = async () => {
    try {
      const r = await api.dialogFolder();
      if (r.paths.length > 0) onAddFolderPaths(r.paths);
    } catch (err) {
      console.error('[Dropzone] Error al seleccionar carpeta:', err);
    }
  };

  const handlePaste = useCallback((e: ClipboardEvent) => {
    if (!onPasteFiles) return;
    const items = e.clipboardData?.items;
    if (!items) return;
    const files: string[] = [];
    for (const item of Array.from(items)) {
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) {
          const path = window.electronAPI?.getPathForFile(file) ?? '';
          if (path) files.push(path);
        }
      }
    }
    if (files.length > 0) {
      registerLocalPaths(files);
      setPasting(true);
      onPasteFiles(files);
      setTimeout(() => setPasting(false), 500);
    }
  }, [onPasteFiles]);

  useEffect(() => {
    if (!onPasteFiles) return;
    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [handlePaste, onPasteFiles]);

  if (totalCount > 0) {
    const toolbarSeparator = 'mx-1 w-px shrink-0 self-center h-7 bg-[var(--border-subtle)]';

    return (
      <div
        className={`rounded-2xl border transition-colors duration-300 ${
          dragOver
            ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)]/10 shadow-[0_0_24px_var(--accent-primary-glow)]'
            : pasting
            ? 'border-[var(--accent-green)] bg-[var(--accent-green)]/10'
            : 'bg-[var(--bg-surface)] border-[var(--border-subtle)]'
        }`}
      >
        <div
          data-testid="dropzone-loaded-row"
          className="flex w-full items-center gap-2 px-5 py-2.5"
        >
          <div
            data-testid="dropzone-secondary-actions"
            className="flex shrink-0 items-center gap-1"
          >
            <Button variant="ghost" size="sm" onClick={onAddFiles}>
              <Plus className="h-3.5 w-3.5" />
              Agregar
            </Button>
            {onImportDatabase && (
              <Button variant="ghost" size="sm" onClick={async () => {
                const r = await api.dialogFiles();
                const path = r?.paths?.[0];
                if (path) onImportDatabase(path);
              }}>
                <Database className="h-3.5 w-3.5" />
                <span className="hidden lg:inline">Base de datos</span>
                <span className="lg:hidden">BD</span>
              </Button>
            )}
          </div>

          <div className={`${toolbarSeparator} hidden sm:block`} />

          <div className="flex shrink-0 items-center">
            <Button variant="ghost" size="sm" onClick={onClear} className="text-[var(--accent-red)] hover:text-[var(--accent-red)]">
              <RotateCcw className="h-3.5 w-3.5" />
              Limpiar
            </Button>
          </div>

          {centerControls && (
            <>
              <div className={toolbarSeparator} />
              <div className="flex shrink-0 items-center gap-2">
                {centerControls}
              </div>
            </>
          )}

          <div className="ml-auto flex min-w-0 shrink-0 items-center gap-3">
            {progressIndicator}
            {conversionAction}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 w-full flex-1 items-center justify-center p-4">
      <div
        className={`flex aspect-square w-[min(380px,calc(100vw-2rem))] max-h-[min(380px,calc(100vh-12rem))] flex-col items-center justify-center rounded-2xl border-2 border-dashed px-4 py-5 text-center transition-all duration-500 ${
          dragOver
            ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)]/5 shadow-[0_0_40px_var(--accent-primary-glow)] scale-[1.02]'
            : pasting
            ? 'border-[var(--accent-green)] bg-[var(--accent-green)]/5'
            : 'border-[var(--border-medium)] bg-[var(--bg-surface)] hover:border-[var(--border-medium)] hover:bg-[var(--bg-elevated)]/30'
        }`}
      >
        <div className="mb-3 w-full min-w-0 px-1">
          <div className={`mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] shadow-sm transition-transform duration-500 ${dragOver ? 'scale-110' : ''}`}>
            <UploadCloud className={`h-6 w-6 transition-colors duration-300 ${dragOver ? 'text-[var(--accent-primary)]' : 'text-[var(--text-muted)]'}`} />
          </div>
          <h3 className="mb-1.5 text-base font-semibold leading-snug text-[var(--text-primary)]">
            {dragOver ? 'Suelta los archivos aquí' : pasting ? 'Pegando archivos...' : 'Arrastra imágenes o videos aquí'}
          </h3>
          <p className="mx-auto mb-3 max-w-[260px] text-[11px] leading-relaxed text-[var(--text-muted)]">
            También puedes usar Ctrl+V para pegar desde el portapapeles
          </p>

          <div className="mb-2.5 flex flex-wrap items-center justify-center gap-1">
            <div className="mr-0.5 flex items-center gap-1 text-[9px] text-[var(--text-muted)]">
              <FileImage className="h-2.5 w-2.5" />
              <span>Imágenes:</span>
            </div>
            {SUPPORTED_IMAGE_FORMATS.map((fmt) => (
              <span key={fmt} className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-1 py-0.5 font-mono text-[9px] text-[var(--text-secondary)]">
                {fmt}
              </span>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-center gap-1">
            <div className="mr-0.5 flex items-center gap-1 text-[9px] text-[var(--text-muted)]">
              <Film className="h-2.5 w-2.5" />
              <span>Videos:</span>
            </div>
            {SUPPORTED_VIDEO_FORMATS.slice(0, 6).map((fmt) => (
              <span key={fmt} className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-1 py-0.5 font-mono text-[9px] text-[var(--text-secondary)]">
                {fmt}
              </span>
            ))}
            <span className="text-[9px] text-[var(--text-muted)]">+{SUPPORTED_VIDEO_FORMATS.length - 6} más</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button variant="secondary" size="sm" onClick={onAddFiles}>
            <Plus className="h-3.5 w-3.5" />
            Seleccionar archivos
          </Button>
          <Button variant="secondary" size="sm" onClick={openFolderPicker}>
            <Folder className="h-3.5 w-3.5" />
            Subir carpeta
          </Button>
        </div>
      </div>
    </div>
  );
}
