import { useState, useEffect, useCallback, type ReactNode } from 'react';
import Button from '../ui/Button';
import { Folder, Images, Plus, RotateCcw, UploadCloud, FileImage, Film, Database, FileSpreadsheet, ArrowRightLeft } from 'lucide-react';

interface DropzoneProps {
  dragOver: boolean;
  onAddFiles: () => void;
  onAddFolder: () => void;
  onImportDatabase?: () => void;
  onLoadMapping?: () => void;
  onGenerateTemplate?: () => void;
  onGenerateMappingTemplate?: () => void;
  fileCount?: number;
  onClear?: () => void;
  videoCount?: number;
  onPasteFiles?: (files: string[]) => void;
  centerControls?: ReactNode;
  conversionAction?: ReactNode;
}

export default function Dropzone({
  dragOver,
  onAddFiles,
  onAddFolder,
  onImportDatabase,
  onLoadMapping,
  onGenerateTemplate,
  onGenerateMappingTemplate,
  fileCount = 0,
  onClear,
  videoCount = 0,
  onPasteFiles,
  centerControls,
  conversionAction,
}: DropzoneProps) {
  const totalCount = fileCount + videoCount;
  const imageCount = fileCount;
  const [pasting, setPasting] = useState(false);

  const SUPPORTED_IMAGE_FORMATS = ['JPG', 'JPEG', 'PNG', 'WEBP', 'TIFF', 'BMP', 'GIF', 'ICO', 'PDF'];
  const SUPPORTED_VIDEO_FORMATS = ['MP4', 'AVI', 'MOV', 'MKV', 'WMV', 'FLV', 'WEBM', 'M4V', '3GP', 'MPG', 'MPEG'];

  const handlePaste = useCallback((e: ClipboardEvent) => {
    if (!onPasteFiles) return;
    const items = e.clipboardData?.items;
    if (!items) return;
    const files: string[] = [];
    for (const item of Array.from(items)) {
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) {
          // Try to get path from Electron, fallback to name
          const path = (file as any).path || file.name;
          if (path) files.push(path);
        }
      }
    }
    if (files.length > 0) {
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
    return (
      <div
        className={`flex flex-wrap items-center gap-3 rounded-2xl border px-5 py-3.5 transition-all duration-300 ${
          dragOver
            ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)]/10 shadow-[0_0_24px_var(--accent-primary-glow)] scale-[1.01]'
            : pasting
            ? 'border-[var(--accent-green)] bg-[var(--accent-green)]/10'
            : 'bg-[var(--bg-surface)] border-[var(--border-subtle)]'
        }`}
      >
        <div className="flex shrink-0 items-center gap-4">
          <div className={`flex items-center justify-center w-10 h-10 rounded-xl transition-all duration-300 ${
            dragOver ? 'bg-[var(--accent-primary)]/20 text-[var(--accent-primary)] scale-110' : 'bg-[var(--bg-elevated)] text-[var(--text-secondary)]'
          }`}>
            <Images className="h-5 w-5" />
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-semibold text-[var(--text-primary)]">
              {imageCount} imagen{imageCount !== 1 ? 'es' : ''}
              {videoCount > 0 && ` + ${videoCount} video${videoCount !== 1 ? 's' : ''}`}
            </span>
            <span className="text-[11px] text-[var(--text-muted)]">
              {dragOver ? 'Suelta para agregar' : pasting ? 'Pegando archivos...' : 'Listo para convertir'}
            </span>
          </div>
        </div>
        {centerControls && (
          <div className="flex min-w-0 flex-1 items-center">
            {centerControls}
          </div>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {onImportDatabase && (
            <Button variant="ghost" size="sm" onClick={onImportDatabase}>
              <Database className="h-3.5 w-3.5" />
              Base de datos
            </Button>
          )}
          {onLoadMapping && (
            <Button variant="ghost" size="sm" onClick={onLoadMapping} className="text-[var(--accent-primary)]">
              <ArrowRightLeft className="h-3.5 w-3.5" />
              Cargar mapeo (ID → RENOMBRE)
            </Button>
          )}
          {onGenerateTemplate && (
            <Button variant="ghost" size="sm" onClick={onGenerateTemplate}>
              <FileSpreadsheet className="h-3.5 w-3.5" />
              Plantilla BD
            </Button>
          )}
          {onGenerateMappingTemplate && (
            <Button variant="ghost" size="sm" onClick={onGenerateMappingTemplate}>
              <ArrowRightLeft className="h-3.5 w-3.5" />
              Plantilla mapeo
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={onAddFiles}>
            <Plus className="h-3.5 w-3.5" />
            Agregar
          </Button>
          <Button variant="ghost" size="sm" onClick={onAddFolder}>
            <Folder className="w-3.5 h-3.5" />
            Carpeta
          </Button>
          <div className="w-px h-4 bg-[var(--border-medium)] mx-1" />
          <Button variant="ghost" size="sm" onClick={onClear} className="text-[var(--accent-red)] hover:text-[var(--accent-red)]">
            <RotateCcw className="h-3.5 w-3.5" />
            Limpiar
          </Button>
          {conversionAction && (
            <>
              <div className="w-px h-4 bg-[var(--border-medium)] mx-1" />
              {conversionAction}
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className={`flex min-h-[280px] flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-10 text-center transition-all duration-500 ${
        dragOver
          ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)]/5 shadow-[0_0_40px_var(--accent-primary-glow)] scale-[1.02]'
          : pasting
          ? 'border-[var(--accent-green)] bg-[var(--accent-green)]/5'
          : 'border-[var(--border-medium)] bg-[var(--bg-surface)] hover:border-[var(--border-medium)] hover:bg-[var(--bg-elevated)]/30'
      }`}
    >
      <div className="mb-6">
        <div className={`mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] shadow-sm transition-transform duration-500 ${dragOver ? 'scale-110' : ''}`}>
          <UploadCloud className={`h-7 w-7 transition-colors duration-300 ${dragOver ? 'text-[var(--accent-primary)]' : 'text-[var(--text-muted)]'}`} />
        </div>
        <h3 className="mb-2 text-xl font-semibold text-[var(--text-primary)]">
          {dragOver ? 'Suelta los archivos aquí' : pasting ? 'Pegando archivos...' : 'Arrastra imágenes o videos aquí'}
        </h3>
        <p className="mx-auto max-w-sm text-xs leading-relaxed text-[var(--text-muted)] mb-4">
          También puedes usar Ctrl+V para pegar desde el portapapeles
        </p>

        <div className="flex flex-wrap items-center justify-center gap-1.5 mb-5 max-w-md">
          <div className="flex items-center gap-1 text-[10px] text-[var(--text-muted)] mr-1">
            <FileImage className="h-3 w-3" />
            <span>Imágenes:</span>
          </div>
          {SUPPORTED_IMAGE_FORMATS.map((fmt) => (
            <span key={fmt} className="px-1.5 py-0.5 rounded-md bg-[var(--bg-elevated)] text-[var(--text-secondary)] text-[10px] font-mono border border-[var(--border-subtle)]">
              {fmt}
            </span>
          ))}
        </div>
        <div className="flex flex-wrap items-center justify-center gap-1.5 max-w-md">
          <div className="flex items-center gap-1 text-[10px] text-[var(--text-muted)] mr-1">
            <Film className="h-3 w-3" />
            <span>Videos:</span>
          </div>
          {SUPPORTED_VIDEO_FORMATS.slice(0, 6).map((fmt) => (
            <span key={fmt} className="px-1.5 py-0.5 rounded-md bg-[var(--bg-elevated)] text-[var(--text-secondary)] text-[10px] font-mono border border-[var(--border-subtle)]">
              {fmt}
            </span>
          ))}
          <span className="text-[10px] text-[var(--text-muted)]">+{SUPPORTED_VIDEO_FORMATS.length - 6} más</span>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Button variant="secondary" size="sm" onClick={onAddFiles}>
          <Plus className="h-3.5 w-3.5" />
          Seleccionar archivos
        </Button>
        <Button variant="secondary" size="sm" onClick={onAddFolder}>
          <Folder className="h-3.5 w-3.5" />
          Escanear carpeta
        </Button>
      </div>
    </div>
  );
}
