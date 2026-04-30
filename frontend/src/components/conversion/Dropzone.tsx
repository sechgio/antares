import Button from '../ui/Button';

interface DropzoneProps {
  dragOver: boolean;
  onAddFiles: () => void;
  onAddFolder: () => void;
  fileCount?: number;
  onClear?: () => void;
  videoCount?: number;
}

function UploadIcon({ className }: { className?: string }) {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

export default function Dropzone({
  dragOver,
  onAddFiles,
  onAddFolder,
  fileCount = 0,
  onClear,
  videoCount = 0,
}: DropzoneProps) {
  const totalCount = fileCount + videoCount;
  const imageCount = fileCount;

  // When files exist: show only a compact header bar with count + add more
  if (totalCount > 0) {
    return (
      <div
        className={`flex items-center justify-between rounded-xl border px-4 py-2.5 transition-all duration-200 ${
          dragOver
            ? 'border-[#5E6AD2] bg-[#5E6AD2]/10 shadow-[0_0_20px_rgba(94,106,210,0.08)]'
            : 'bg-[#111111] border-[#1A1A1A]'
        }`}
      >
        <div className="flex items-center gap-3">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={dragOver ? 'text-[#5E6AD2]' : 'text-[#A0A0A0]'}>
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
          </svg>
          <span className="text-[13px] text-white font-medium">
            {imageCount} imagen{imageCount !== 1 ? 'es' : ''}{videoCount > 0 ? ` + ${videoCount} video${videoCount !== 1 ? 's' : ''}` : ''} cargada{totalCount !== 1 ? 's' : ''}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onAddFiles}>+ Agregar más</Button>
          <Button variant="ghost" size="sm" onClick={onAddFolder}>Escanear carpeta</Button>
          <Button variant="ghost" size="sm" onClick={onClear} className="text-[#EF4444] hover:text-[#EF4444]">Limpiar</Button>
        </div>
      </div>
    );
  }

  // No files: show full dropzone area
  return (
    <div
      className={`flex flex-col items-center justify-center text-center rounded-2xl border-2 border-dashed transition-all duration-300 ${
        dragOver
          ? 'border-[#5E6AD2] bg-[#5E6AD2]/5 scale-[1.01] shadow-[0_0_30px_rgba(94,106,210,0.1)]'
          : 'border-[#2A2A2A] bg-[#111111] min-h-[50vh]'
      }`}
    >
      <div className="mb-6">
        <div className="w-16 h-16 rounded-2xl bg-[#1A1A1A] flex items-center justify-center mb-4 border border-[#222222]">
          <UploadIcon className="w-8 h-8 text-[#666666]" />
        </div>
        <h3 className="text-2xl font-medium text-white mb-2">
          {dragOver ? 'Suelta las imágenes aquí' : 'Arrastra imágenes aquí'}
        </h3>
        <p className="text-sm text-[#666666]">JPG, PNG, WEBP, TIFF, BMP, GIF • Videos: MP4, AVI, MOV, MKV</p>
      </div>
      <div className="flex items-center gap-3">
        <Button variant="secondary" size="sm" onClick={onAddFiles}>Seleccionar archivos</Button>
        <Button variant="secondary" size="sm" onClick={onAddFolder}>Escanear carpeta</Button>
      </div>
    </div>
  );
}
