import React from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Eye,
  Folder,
  Loader2,
  MapPin,
} from 'lucide-react';
import { WithHoverTooltip } from '@/components/ui/HoverTooltip';
import Button from '../ui/Button';
import type { PreviewData, Result } from './ubicacionesTypes';

export const EmptyPreviewPanel: React.FC<{ formato: string }> = ({ formato }) => (
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
      <div
        className="absolute inset-0 opacity-20"
        style={{
          backgroundImage:
            'url("data:image/svg+xml,%3Csvg width=\'20\' height=\'20\' viewBox=\'0 0 20 20\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cg fill=\'%23666666\' fill-opacity=\'0.5\' fill-rule=\'evenodd\'%3E%3Ccircle cx=\'3\' cy=\'3\' r=\'3\'/%3E%3Ccircle cx=\'13\' cy=\'13\' r=\'3\'/%3E%3C/g%3E%3C/svg%3E")',
        }}
      />
      <div className="absolute inset-0 bg-[color:color-mix(in_srgb,var(--bg-base)_30%,transparent)]" />
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

export const RealPreviewPanel: React.FC<{
  preview: PreviewData;
  loading: boolean;
  error: string | null;
  rowIndex: number;
  totalFilas: number;
  isProcessing: boolean;
  onPrev: () => void;
  onNext: () => void;
  onRefresh: () => void;
  inputMode?: 'excel' | 'manual';
  manualData?: {
    cod_componente: string;
    direccion: string;
    localidad: string;
    distrito: string;
  };
}> = ({
  preview,
  loading,
  error,
  rowIndex,
  totalFilas,
  isProcessing,
  onPrev,
  onNext,
  onRefresh,
  inputMode = 'excel',
  manualData,
}) => {
  const meta = inputMode === 'manual' && manualData
    ? manualData
    : preview
      ? {
          cod_componente: preview.cod_componente,
          direccion: preview.direccion,
          localidad: preview.localidad,
          distrito: preview.distrito,
        }
      : null;
  const showMeta = meta && (
    meta.cod_componente || meta.direccion || meta.localidad || meta.distrito
  );

  return (
  <div className="flex-1 flex flex-col overflow-hidden">
    <div className="shrink-0 flex items-center justify-between px-5 h-11 border-b border-[var(--border-subtle)] bg-[var(--bg-base)]">
      <div className="flex items-center gap-2.5">
        <Eye size={18} className="text-[var(--accent-primary)] shrink-0" />
        <span className="text-sm font-semibold text-[var(--text-primary)]">Vista Previa Real</span>
      </div>

      {(inputMode === 'excel' ? totalFilas > 0 : true) && (
        <div className="flex items-center gap-1">
          {inputMode === 'excel' && totalFilas > 0 && (
            <>
              <Button variant="none" size="none"
                onClick={onPrev}
                disabled={rowIndex === 0 || loading}
                aria-label="Fila anterior"
                className="p-1.5 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-[var(--text-muted)]"
              >
                <ChevronLeft size={16} />
              </Button>
              <span className="text-[11px] text-[var(--text-muted)] tabular-nums min-w-[3rem] text-center">
                {rowIndex + 1} / {totalFilas}
              </span>
              <Button variant="none" size="none"
                onClick={onNext}
                disabled={rowIndex >= totalFilas - 1 || loading}
                aria-label="Fila siguiente"
                className="p-1.5 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-[var(--text-muted)]"
              >
                <ChevronRight size={16} />
              </Button>
            </>
          )}
          <WithHoverTooltip label="Actualizar vista previa" placement="bottom">
            <Button variant="none" size="none"
              onClick={onRefresh}
              disabled={loading}
              aria-label="Actualizar vista previa"
              className="ml-1.5 p-1.5 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-[var(--text-muted)]"
            >
              <Loader2 size={14} className={loading ? 'animate-spin' : ''} />
            </Button>
          </WithHoverTooltip>
        </div>
      )}

    </div>

    <div className="flex-1 overflow-hidden flex items-center justify-center bg-[var(--bg-elevated)] p-6 relative">
      {error ? (
        <div className="flex flex-col items-center gap-3 max-w-sm">
          <div className="w-12 h-12 rounded-full bg-[color:color-mix(in_srgb,var(--accent-red)_15%,transparent)] flex items-center justify-center">
            <AlertCircle size={24} className="text-[var(--accent-red)]" />
          </div>
          <p className="text-sm font-medium text-[var(--accent-red)]">Error en vista previa</p>
          <p className="text-xs text-[var(--text-muted)] text-center break-words leading-relaxed">{error}</p>
          <Button variant="none" size="none"
            onClick={onRefresh}
            className="mt-1 text-[11px] font-medium text-[var(--accent-primary)] hover:underline"
          >
            Reintentar
          </Button>
        </div>
      ) : preview ? (
        <div className="flex flex-col items-center gap-4 w-full h-full relative">
          <div className="flex-1 w-full flex items-center justify-center overflow-hidden relative">
            {loading && (
              <div className="absolute top-3 right-3 z-10 flex items-center gap-2 rounded-lg bg-[color:color-mix(in_srgb,var(--bg-base)_90%,transparent)] border border-[var(--border-subtle)] px-2.5 py-1.5 shadow-sm">
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
          {showMeta && (
          <div className="flex items-center gap-3 shrink-0 px-4 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] max-w-full overflow-hidden">
            <span className="text-sm font-bold text-[var(--text-primary)] shrink-0">{meta!.cod_componente || '—'}</span>
            <span className="text-xs text-[var(--text-muted)] shrink-0">|</span>
            <span className="text-xs text-[var(--text-secondary)] truncate">{meta!.direccion || '—'}</span>
            <span className="text-xs text-[var(--text-muted)] shrink-0">|</span>
            <span className="text-[11px] text-[var(--text-muted)] shrink-0">
              {meta!.localidad || '—'} - {meta!.distrito || '—'}
            </span>
          </div>
          )}
          {isProcessing && (
            <div className="flex items-center gap-2 text-[var(--text-secondary)] shrink-0">
              <Loader2 size={14} className="animate-spin text-[var(--accent-primary)]" />
              <span className="text-xs">Generando PDFs...</span>
            </div>
          )}
        </div>
      ) : loading ? (
        <div className="flex flex-col items-center gap-4 w-full h-full">
          <div className="flex-1 flex flex-col items-center justify-center gap-3">
            <Loader2 size={32} className="animate-spin text-[var(--accent-primary)]" />
            <p className="text-xs text-[var(--text-muted)]">Cargando mapa...</p>
          </div>
          {showMeta && (
            <div className="flex items-center gap-3 shrink-0 px-4 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] max-w-full overflow-hidden">
              <span className="text-sm font-bold text-[var(--text-primary)] shrink-0">{meta!.cod_componente || '—'}</span>
              <span className="text-xs text-[var(--text-muted)] shrink-0">|</span>
              <span className="text-xs text-[var(--text-secondary)] truncate">{meta!.direccion || '—'}</span>
              <span className="text-xs text-[var(--text-muted)] shrink-0">|</span>
              <span className="text-[11px] text-[var(--text-muted)] shrink-0">
                {meta!.localidad || '—'} - {meta!.distrito || '—'}
              </span>
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 max-w-xs text-center">
          <MapPin size={28} className="text-[var(--text-muted)]" />
          <p className="text-xs text-[var(--text-muted)] leading-relaxed">
            {inputMode === 'manual'
              ? 'Ingresa latitud y longitud válidas para ver la vista previa del mapa.'
              : 'Carga un Excel para ver la vista previa real del resultado.'}
          </p>
        </div>
      )}
    </div>
  </div>
  );
};

export const ResultPanel: React.FC<{ result: Result; outputDir: string }> = ({ result, outputDir }) => {
  if (!result) return null;

  if (result.success) {
    const isConsolidado = result.data?.consolidado;
    const generados = result.data?.generados ?? 0;
    const fallidos = result.data?.fallidos ?? 0;
    const allFailed = generados === 0 && fallidos > 0;
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8">
        <div className={`w-16 h-16 rounded-full flex items-center justify-center mb-5 ${allFailed ? 'bg-[color:color-mix(in_srgb,var(--accent-yellow)_15%,transparent)]' : 'bg-[color:color-mix(in_srgb,var(--accent-green)_15%,transparent)]'}`}>
          {allFailed ? (
            <AlertCircle size={32} className="text-amber-400" />
          ) : (
            <CheckCircle2 size={32} className="text-[var(--accent-green)]" />
          )}
        </div>
        <p className="text-lg font-semibold text-[var(--text-primary)] mb-1">
          {allFailed ? 'Proceso completado con errores' : 'Proceso completado'}
        </p>
        <p className="text-sm text-[var(--text-muted)] mb-5">
          {isConsolidado ? (
            <>
              Se generó <span className="font-bold text-[var(--accent-green)]">1 PDF consolidado</span> con{' '}
              <span className="font-bold text-[var(--accent-green)]">{generados} páginas</span>
            </>
          ) : (
            <>
              Se generaron{' '}
              <span className="font-bold text-[var(--accent-green)]">{generados} PDFs</span>
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
          {isConsolidado && result.data?.consolidatedPath && (
            <p className="text-xs font-mono text-[var(--text-secondary)] break-all leading-relaxed mt-2">
              {String(result.data.consolidatedPath).split(/[/\\]/).pop()}
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8">
      <div className="w-16 h-16 rounded-full bg-[color:color-mix(in_srgb,var(--accent-red)_15%,transparent)] flex items-center justify-center mb-5">
        <AlertCircle size={32} className="text-[var(--accent-red)]" />
      </div>
      <p className="text-lg font-semibold text-[var(--accent-red)] mb-3">Error</p>
      <div className="max-w-md w-full rounded-xl border border-[color:color-mix(in_srgb,var(--accent-red)_20%,transparent)] bg-[color:color-mix(in_srgb,var(--accent-red)_5%,transparent)] p-4">
        <p className="text-sm text-[color:color-mix(in_srgb,var(--accent-red)_90%,transparent)] break-words leading-relaxed">{result.error}</p>
      </div>
    </div>
  );
};
