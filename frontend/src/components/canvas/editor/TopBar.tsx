import { Copy, Keyboard, Lock, Redo2, Undo2, Unlock } from 'lucide-react';
import { WithHoverTooltip } from '@/components/ui/HoverTooltip';
import type { CanvasMode } from '../types';
import BrandFace from './BrandFace';
import { CanvasSegmented } from './CanvasControls';
import PreviewButton from './PreviewButton';
import SaveButton from './SaveButton';

interface TopBarProps {
  name: string;
  mode: CanvasMode;
  canUndo: boolean;
  canRedo: boolean;
  status: string | null;
  showShortcuts?: boolean;
  previewOpen?: boolean;
  onToggleShortcuts?: () => void;
  onTogglePreview?: () => void;
  onNameChange: (name: string) => void;
  onNameStart?: () => void;
  onNameCommit?: () => void;
  onMode: (mode: CanvasMode) => void;
  onUndo: () => void;
  onRedo: () => void;
  onSave: () => void;
  onDuplicate: () => void;
  /** Design-mode UI chrome lock (panels stay put). */
  uiLocked?: boolean;
  onToggleUiLock?: () => void;
  /** When true, brand+name span matches left sidebar width so the edge aligns. */
  leftPanelOpen?: boolean;
}

function TopBarDivider() {
  return <div className="canvas-topbar-divider" aria-hidden />;
}

export default function TopBar({
  name,
  mode,
  canUndo,
  canRedo,
  status,
  showShortcuts,
  previewOpen = false,
  onToggleShortcuts,
  onTogglePreview,
  onNameChange,
  onNameStart,
  onNameCommit,
  onMode,
  onUndo,
  onRedo,
  onSave,
  onDuplicate,
  uiLocked = false,
  onToggleUiLock,
  leftPanelOpen = true,
}: TopBarProps) {
  return (
    <header className="canvas-topbar relative flex shrink-0 items-center">
      <div
        className={
          leftPanelOpen
            ? 'canvas-topbar-leading canvas-topbar-leading--panel'
            : 'canvas-topbar-leading'
        }
      >
        <div className="canvas-brand-mark" aria-hidden>
          <BrandFace />
        </div>
        <input
          className="min-w-0 flex-1 border-0 bg-transparent text-[13px] font-semibold leading-none outline-none placeholder:text-[var(--cv-text-muted)]"
          style={{ color: 'var(--cv-text)' }}
          value={name}
          title={name || undefined}
          onChange={(e) => onNameChange(e.target.value)}
          onFocus={onNameStart}
          onBlur={onNameCommit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.currentTarget.blur();
            } else if (e.key === 'Escape') {
              e.currentTarget.blur();
            }
          }}
          placeholder="Sin título"
          aria-label="Nombre del documento"
        />
        {!leftPanelOpen ? <TopBarDivider /> : null}
      </div>

      <div className="canvas-topbar-tools px-1.5">
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
        {mode === 'design' && onToggleUiLock && (
          <>
            <TopBarDivider />
            <WithHoverTooltip
              label={uiLocked ? 'Desbloquear UI' : 'Bloquear UI'}
              placement="bottom"
              variant="dark"
            >
              <button
                type="button"
                className="canvas-icon-btn"
                data-active={uiLocked}
                data-testid="canvas-ui-lock"
                onClick={onToggleUiLock}
                aria-label={uiLocked ? 'Desbloquear UI' : 'Bloquear UI'}
                aria-pressed={uiLocked}
              >
                {uiLocked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
              </button>
            </WithHoverTooltip>
          </>
        )}
      </div>

      {/* Absolutely centered so it never shifts when side content changes (Figma-like). */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
        <CanvasSegmented
          value={mode}
          onChange={onMode}
          ariaLabel="Modo de trabajo"
          options={[
            { value: 'design', label: 'Diseñar' },
            { value: 'generate', label: 'Generar' },
          ]}
        />
      </div>

      <div className="ml-auto flex h-8 items-center gap-2 px-3">
        {status && (
          <span className="canvas-status-pill" role="status">
            {status}
          </span>
        )}

        {mode === 'design' && onTogglePreview && (
          <PreviewButton active={Boolean(previewOpen)} onToggle={onTogglePreview} />
        )}

        <WithHoverTooltip label="Guardar" shortcut="Ctrl+S" placement="bottom" variant="dark">
          <SaveButton onSave={onSave} />
        </WithHoverTooltip>
      </div>
    </header>
  );
}
