import { Copy, Keyboard, Redo2, Save, Undo2 } from 'lucide-react';
import { WithHoverTooltip } from '@/components/ui/HoverTooltip';
import type { CanvasMode } from '../types';
import { CanvasSegmented } from './CanvasControls';

interface TopBarProps {
  name: string;
  mode: CanvasMode;
  canUndo: boolean;
  canRedo: boolean;
  status: string | null;
  showShortcuts?: boolean;
  onToggleShortcuts?: () => void;
  onNameChange: (name: string) => void;
  onMode: (mode: CanvasMode) => void;
  onUndo: () => void;
  onRedo: () => void;
  onSave: () => void;
  onDuplicate: () => void;
}

export default function TopBar({
  name,
  mode,
  canUndo,
  canRedo,
  status,
  showShortcuts,
  onToggleShortcuts,
  onNameChange,
  onMode,
  onUndo,
  onRedo,
  onSave,
  onDuplicate,
}: TopBarProps) {
  return (
    <header className="canvas-topbar flex shrink-0 items-center gap-2 px-3">
      <div className="canvas-brand-mark" aria-hidden>
        C
      </div>
      <input
        className="min-w-0 max-w-[220px] border-0 bg-transparent text-[13px] font-semibold outline-none placeholder:text-[var(--cv-text-muted)]"
        style={{ color: 'var(--cv-text)' }}
        value={name}
        onChange={(e) => onNameChange(e.target.value)}
        placeholder="Sin título"
        aria-label="Nombre del documento"
      />

      <div className="mx-1 h-5 w-px" style={{ background: 'var(--cv-border)' }} />

      <div className="flex items-center gap-0.5">
        <WithHoverTooltip label="Deshacer" shortcut="Ctrl+Z" placement="bottom" variant="dark">
          <button
            type="button"
            className="canvas-icon-btn"
            disabled={!canUndo}
            onClick={onUndo}
            aria-label="Deshacer"
          >
            <Undo2 className="h-3.5 w-3.5" />
          </button>
        </WithHoverTooltip>
        <WithHoverTooltip label="Rehacer" shortcut="Ctrl+Shift+Z" placement="bottom" variant="dark">
          <button
            type="button"
            className="canvas-icon-btn"
            disabled={!canRedo}
            onClick={onRedo}
            aria-label="Rehacer"
          >
            <Redo2 className="h-3.5 w-3.5" />
          </button>
        </WithHoverTooltip>
        <WithHoverTooltip label="Duplicar" placement="bottom" variant="dark">
          <button type="button" className="canvas-icon-btn" onClick={onDuplicate} aria-label="Duplicar documento">
            <Copy className="h-3.5 w-3.5" />
          </button>
        </WithHoverTooltip>
        {mode === 'design' && onToggleShortcuts && (
          <WithHoverTooltip label="Atajos" shortcut="?" placement="bottom" variant="dark">
            <button
              type="button"
              className="canvas-icon-btn"
              data-active={showShortcuts}
              onClick={onToggleShortcuts}
              aria-label="Atajos"
              aria-pressed={showShortcuts}
            >
              <Keyboard className="h-3.5 w-3.5" />
            </button>
          </WithHoverTooltip>
        )}
      </div>

      <div className="mx-auto">
        <CanvasSegmented
          value={mode}
          onChange={onMode}
          options={[
            { value: 'design', label: 'Diseñar' },
            { value: 'generate', label: 'Generar' },
          ]}
        />
      </div>

      {status && <span className="canvas-status-pill">{status}</span>}

      <WithHoverTooltip label="Guardar" shortcut="Ctrl+S" placement="bottom" variant="dark">
        <button type="button" onClick={onSave} className="canvas-btn-primary" aria-label="Guardar">
          <Save className="h-3.5 w-3.5" />
          Guardar
        </button>
      </WithHoverTooltip>
    </header>
  );
}
