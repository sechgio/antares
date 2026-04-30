import { Crop, Download, FileImage, Gauge, Maximize2, Tag } from 'lucide-react';
import { ASPECT_RATIO_OPTIONS, BatchSettings, ImageItem } from './types';
import { OperationSection, SegmentedControl } from './ui';

interface SettingsPanelProps {
  settings: BatchSettings;
  previewNames: string[];
  activeItem: ImageItem | null;
  renameOnlyMode: boolean;
  onUpdateSettings: (updater: (draft: BatchSettings) => void) => void;
  onOpenCropEditor: () => void;
}

export default function SettingsPanel({
  settings,
  previewNames,
  activeItem,
  renameOnlyMode,
  onUpdateSettings,
  onOpenCropEditor,
}: SettingsPanelProps) {
  return (
    <aside className="custom-scrollbar flex flex-col gap-2.5 h-full overflow-y-auto xl:pr-1">

      {/* Recorte */}
      <OperationSection
        title="Recorte"
        icon={<Crop size={14} />}
        accentColor="#8B5CF6"
        enabled={settings.operations.cropEnabled}
        onToggle={(v) => onUpdateSettings((d) => { d.operations.cropEnabled = v; })}
        disabled={renameOnlyMode}
      >
        <label className="block space-y-1.5">
          <span className="text-[10px] font-mono text-[var(--text-muted)] uppercase tracking-widest">Relación</span>
          <select
            value={settings.crop.aspectRatio}
            onChange={(e) => onUpdateSettings((draft) => { draft.crop.aspectRatio = e.target.value as BatchSettings['crop']['aspectRatio']; })}
            className="w-full appearance-none rounded-lg border border-[var(--border-medium)] bg-[var(--bg-base)] px-3 py-2 text-[11px] font-mono text-[var(--text-primary)] outline-none transition-colors focus:border-[var(--accent-primary)]"
          >
            {ASPECT_RATIO_OPTIONS.map((option) => (
              <option key={option.value} value={option.value} className="bg-[var(--bg-base)] text-[var(--text-primary)]">
                {option.label}
              </option>
            ))}
          </select>
        </label>
        {settings.crop.aspectRatio !== 'original' && (
          <label className="block space-y-1.5">
            <span className="text-[10px] font-mono text-[var(--text-muted)] uppercase tracking-widest">Dirección</span>
            <SegmentedControl
              value={settings.crop.cropOrigin}
              options={[
                { value: 'top', label: 'Arriba → Abajo' },
                { value: 'bottom', label: 'Abajo → Arriba' },
              ]}
              onChange={(value) => onUpdateSettings((draft) => { draft.crop.cropOrigin = value as 'top' | 'bottom'; })}
            />
          </label>
        )}
        <button
          onClick={onOpenCropEditor}
          disabled={!activeItem || !settings.operations.cropEnabled || settings.crop.aspectRatio === 'original'}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-[var(--border-medium)] bg-[var(--bg-surface)] px-4 py-2 text-[11px] font-mono text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] disabled:pointer-events-none disabled:opacity-30"
        >
          <Crop size={13} />
          Ajustar recorte activo
        </button>
      </OperationSection>

      {/* Redimensionar */}
      <OperationSection
        title="Redimensionar"
        icon={<Maximize2 size={14} />}
        accentColor="#3B82F6"
        enabled={settings.operations.resizeEnabled}
        onToggle={(v) => onUpdateSettings((d) => { d.operations.resizeEnabled = v; })}
        disabled={renameOnlyMode}
      >
        <div className="grid gap-3 grid-cols-2">
          <label className="block space-y-1.5">
            <span className="text-[10px] font-mono text-[var(--text-muted)] uppercase tracking-widest">Ancho max</span>
            <input
              type="number"
              min="1"
              value={settings.resize.maxWidth}
              onChange={(e) => onUpdateSettings((draft) => { draft.resize.maxWidth = Math.max(1, Number(e.target.value) || 1); })}
              className="w-full rounded-lg border border-[var(--border-medium)] bg-[var(--bg-base)] px-3 py-2 text-[11px] font-mono text-[var(--text-primary)] outline-none transition-colors focus:border-[var(--accent-primary)]"
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-[10px] font-mono text-[var(--text-muted)] uppercase tracking-widest">Alto max</span>
            <input
              type="number"
              min="1"
              value={settings.resize.maxHeight}
              onChange={(e) => onUpdateSettings((draft) => { draft.resize.maxHeight = Math.max(1, Number(e.target.value) || 1); })}
              className="w-full rounded-lg border border-[var(--border-medium)] bg-[var(--bg-base)] px-3 py-2 text-[11px] font-mono text-[var(--text-primary)] outline-none transition-colors focus:border-[var(--accent-primary)]"
            />
          </label>
        </div>
        <label className="flex cursor-pointer items-center justify-between rounded-lg border border-[var(--border-medium)] bg-[var(--bg-base)] px-3 py-2.5 transition-colors hover:bg-[var(--bg-surface)]">
          <span className="text-[11px] font-mono text-[var(--text-primary)]">No ampliar pequeñas</span>
          <input
            type="checkbox"
            checked={settings.resize.noUpscale}
            onChange={(e) => onUpdateSettings((draft) => { draft.resize.noUpscale = e.target.checked; })}
            className="h-3.5 w-3.5 rounded border-[var(--border-medium)] bg-[var(--bg-base)] text-[var(--accent-primary)] focus:ring-[var(--accent-primary)] focus:ring-offset-0"
          />
        </label>
      </OperationSection>

      {/* Formato */}
      <OperationSection
        title="Formato"
        icon={<FileImage size={14} />}
        accentColor="#10B981"
        enabled={settings.operations.formatEnabled}
        onToggle={(v) => onUpdateSettings((d) => { d.operations.formatEnabled = v; })}
        disabled={renameOnlyMode}
      >
        <label className="block space-y-1.5">
          <span className="text-[10px] font-mono text-[var(--text-muted)] uppercase tracking-widest">Salida</span>
          <select
            value={settings.format.outputFormat}
            onChange={(e) => onUpdateSettings((draft) => { draft.format.outputFormat = e.target.value as BatchSettings['format']['outputFormat']; })}
            className="w-full appearance-none rounded-lg border border-[var(--border-medium)] bg-[var(--bg-base)] px-3 py-2 text-[11px] font-mono text-[var(--text-primary)] outline-none transition-colors focus:border-[var(--accent-primary)]"
          >
            <option value="original" className="bg-[var(--bg-base)]">Original</option>
            <option value="jpeg" className="bg-[var(--bg-base)]">JPEG</option>
            <option value="png" className="bg-[var(--bg-base)]">PNG</option>
            <option value="webp" className="bg-[var(--bg-base)]">WEBP</option>
          </select>
        </label>
      </OperationSection>

      {/* Compresión */}
      <OperationSection
        title="Compresión"
        icon={<Gauge size={14} />}
        accentColor="#F59E0B"
        enabled={settings.operations.compressionEnabled}
        onToggle={(v) => onUpdateSettings((d) => { d.operations.compressionEnabled = v; })}
        disabled={renameOnlyMode}
      >
        <label className="block space-y-1.5">
          <span className="flex items-center justify-between text-[10px] font-mono text-[var(--text-muted)] uppercase tracking-widest">
            <span>Calidad</span>
            <span className="text-[var(--text-primary)]">{Math.round(settings.compression.quality * 100)}%</span>
          </span>
          <input
            type="range"
            min="0.1"
            max="1"
            step="0.05"
            value={settings.compression.quality}
            onChange={(e) => onUpdateSettings((draft) => { draft.compression.quality = Number(e.target.value); })}
            className="w-full accent-[var(--text-primary)] opacity-80 hover:opacity-100"
          />
        </label>
        <label className="block space-y-1.5">
          <span className="text-[10px] font-mono text-[var(--text-muted)] uppercase tracking-widest">Peso máximo (MB)</span>
          <input
            type="number"
            min="0.1"
            step="0.1"
            value={settings.compression.maxSizeMB}
            onChange={(e) => onUpdateSettings((draft) => { draft.compression.maxSizeMB = Math.max(0.1, Number(e.target.value) || 0.1); })}
            className="w-full rounded-lg border border-[var(--border-medium)] bg-[var(--bg-base)] px-3 py-2 text-[11px] font-mono text-[var(--text-primary)] outline-none transition-colors focus:border-[var(--accent-primary)]"
          />
        </label>
      </OperationSection>

      {/* Renombrar — never disabled, even in rename-only mode */}
      <OperationSection
        title="Renombrar"
        icon={<Tag size={14} />}
        accentColor="#06B6D4"
        enabled={settings.operations.renameEnabled}
        onToggle={(v) => onUpdateSettings((d) => { d.operations.renameEnabled = v; })}
      >
        <div className="grid gap-3 grid-cols-2">
          <label className="block space-y-1.5">
            <span className="text-[10px] font-mono text-[var(--text-muted)] uppercase tracking-widest">Prefijo</span>
            <input
              type="text"
              value={settings.rename.prefix}
              onChange={(e) => onUpdateSettings((draft) => { draft.rename.prefix = e.target.value; })}
              className="w-full rounded-lg border border-[var(--border-medium)] bg-[var(--bg-base)] px-3 py-2 text-[11px] font-mono text-[var(--text-primary)] outline-none transition-colors focus:border-[var(--accent-primary)]"
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-[10px] font-mono text-[var(--text-muted)] uppercase tracking-widest">Inicio</span>
            <input
              type="number"
              min="0"
              value={settings.rename.startAt}
              onChange={(e) => onUpdateSettings((draft) => { draft.rename.startAt = Math.max(0, Number(e.target.value) || 0); })}
              className="w-full rounded-lg border border-[var(--border-medium)] bg-[var(--bg-base)] px-3 py-2 text-[11px] font-mono text-[var(--text-primary)] outline-none transition-colors focus:border-[var(--accent-primary)]"
            />
          </label>
        </div>
        <div className="rounded-lg border border-[var(--border-medium)] bg-[var(--bg-base)] px-3 py-2">
          <p className="text-[10px] font-mono text-[var(--text-muted)] uppercase tracking-widest">Preview</p>
          <p className="mt-1 text-[11px] font-mono text-[var(--text-primary)]/90 truncate">{previewNames.join(', ')}</p>
        </div>
      </OperationSection>

      {/* Exportar — always visible, no toggle */}
      <OperationSection
        title="Exportar"
        icon={<Download size={14} />}
        accentColor="#6366F1"
        enabled={true}
      >
        <SegmentedControl
          value={settings.export.mode}
          options={[
            { value: 'zip', label: 'ZIP' },
            { value: 'individual', label: 'Individual' },
          ]}
          onChange={(value) => onUpdateSettings((draft) => { draft.export.mode = value; })}
        />
        {settings.export.mode === 'zip' ? (
          <label className="block space-y-1.5 pt-1">
            <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--text-muted)]">Nombre ZIP</span>
            <input
              type="text"
              value={settings.export.zipName}
              onChange={(e) => onUpdateSettings((draft) => { draft.export.zipName = e.target.value; })}
              className="w-full rounded-lg border border-[var(--border-medium)] bg-[var(--bg-base)] px-3 py-2 text-[11px] font-mono text-[var(--text-primary)] outline-none transition-colors focus:border-[var(--accent-primary)]"
            />
          </label>
        ) : null}
      </OperationSection>
    </aside>
  );
}
