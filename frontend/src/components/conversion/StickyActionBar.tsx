import { Folder, Play, Square, ArrowRight, Image, Tag, Settings, AlertCircle } from 'lucide-react';
import ConversionPresets, { ConversionConfig } from './ConversionPresets';

interface StickyActionBarProps {
  destino: string;
  onSelectDest: () => void;
  onStart: () => void;
  onCancel: () => void;
  running: boolean;
  allReady: boolean;
  summary: string;
  currentConfig?: ConversionConfig;
  onLoadConfig?: (config: ConversionConfig) => void;
  fileCount?: number;
  videoCount?: number;
  imageCount?: number;
  formato?: string;
  calidad?: number;
  resizeEnabled?: boolean;
  usarRename?: boolean;
}

function ActionButton({
  onClick, disabled, variant, children, className = ''
}: {
  onClick?: () => void;
  disabled?: boolean;
  variant: 'primary' | 'danger';
  children: React.ReactNode;
  className?: string;
}) {
  const isPrimary = variant === 'primary';
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-2 rounded-full transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.97] px-6 py-2.5 text-sm font-semibold ${
        isPrimary
          ? 'text-white bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] shadow-lg shadow-[var(--accent-primary)]/20'
          : 'text-[var(--accent-red)] bg-transparent border border-[var(--accent-red)]/40 hover:bg-[var(--accent-red)]/10'
      } ${className}`}
    >
      {children}
    </button>
  );
}

export default function StickyActionBar({
  destino, onSelectDest, onStart, onCancel, running, allReady, summary,
  currentConfig, onLoadConfig,
  fileCount = 0, videoCount = 0, imageCount = 0,
  formato = '', calidad = 0, resizeEnabled = false, usarRename = false,
}: StickyActionBarProps) {
  const destinoLabel = destino
    ? destino.split(/[\\/]/).pop() || destino
    : 'Seleccionar carpeta de destino…';

  const hasFiles = fileCount > 0 || videoCount > 0;

  return (
    <div className="flex items-center justify-between rounded-2xl border px-5 py-3.5 transition-all duration-300 bg-[var(--bg-surface)] border-[var(--border-subtle)]">
      {/* Left: Config + Destination */}
      <div className="flex items-center gap-4 min-w-0">
        {currentConfig && onLoadConfig && (
          <ConversionPresets currentConfig={currentConfig} onLoadConfig={onLoadConfig} className="hidden sm:block shrink-0" />
        )}
        <button
          onClick={onSelectDest}
          className={`flex items-center gap-3 min-w-0 text-left px-4 py-2.5 rounded-xl border transition-all group ${
            destino
              ? 'bg-[var(--bg-elevated)] border-[var(--border-subtle)] hover:border-[var(--border-medium)]'
              : 'bg-[var(--accent-yellow)]/5 border-[var(--accent-yellow)]/30 hover:border-[var(--accent-yellow)]/50'
          }`}
        >
          <div className={`w-9 h-9 rounded-lg flex items-center justify-center transition-colors shrink-0 ${
            destino ? 'bg-[var(--bg-base)] text-[var(--text-muted)] group-hover:text-[var(--accent-primary)]' : 'bg-[var(--accent-yellow)]/10 text-[var(--accent-yellow)]'
          }`}>
            <Folder className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex flex-col">
            <span className="text-[11px] text-[var(--text-muted)] font-medium">Destino</span>
            <span className={`text-[13px] truncate ${destino ? 'text-[var(--text-primary)] font-medium' : 'text-[var(--accent-yellow)]'}`}>
              {destinoLabel}
            </span>
          </div>
          {!destino && <AlertCircle className="h-4 w-4 text-[var(--accent-yellow)] shrink-0 ml-auto" />}
        </button>
      </div>

      {/* Center: Quick Stats */}
      {hasFiles && (
        <div className="hidden md:flex items-center gap-3 shrink-0 mx-4">
          <div className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-subtle)]">
            <Image className="h-3.5 w-3.5 text-[var(--text-muted)]" />
            <div className="flex items-center gap-1 text-xs">
              <span className="font-bold text-[var(--text-primary)]">{imageCount}</span>
              <span className="text-[var(--text-muted)]">img</span>
            </div>
            {videoCount > 0 && (
              <>
                <span className="text-[var(--border-medium)]">|</span>
                <span className="font-bold text-[var(--text-primary)]">{videoCount}</span>
                <span className="text-[var(--text-muted)]">vid</span>
              </>
            )}
          </div>
          <div className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-subtle)]">
            <Settings className="h-3.5 w-3.5 text-[var(--text-muted)]" />
            <span className="text-xs font-bold text-[var(--text-primary)]">{formato}</span>
            <span className="text-[var(--text-muted)] text-xs">·</span>
            <span className="text-xs text-[var(--text-muted)]">{calidad}%</span>
            {resizeEnabled && <span className="text-[10px] text-[var(--accent-primary)] font-medium">R</span>}
            {usarRename && <Tag className="h-3 w-3 text-[var(--accent-secondary)]" />}
          </div>
        </div>
      )}

      {/* Right: Action Button */}
      <div className="flex flex-col items-end gap-1 shrink-0">
        {!running ? (
          <ActionButton variant="primary" onClick={onStart} disabled={!allReady}>
            <Play className="h-4 w-4 fill-current" />
            Iniciar conversión
            <ArrowRight className="h-3.5 w-3.5 opacity-60" />
          </ActionButton>
        ) : (
          <ActionButton variant="danger" onClick={onCancel}>
            <Square className="h-4 w-4 fill-current" />
            Detener
          </ActionButton>
        )}
        {summary && (
          <span className="text-[10px] text-[var(--text-muted)] max-w-[280px] truncate text-right hidden sm:block">
            {summary}
          </span>
        )}
      </div>
    </div>
  );
}
