import type { MouseEventHandler, ReactNode, RefObject } from 'react';
import { WithHoverTooltip } from '@/components/ui/HoverTooltip';

interface FloatingPanelFrameProps {
  panelRef: RefObject<HTMLDivElement | null>;
  position: { x: number; y: number };
  isDragging: boolean;
  isPinned: boolean;
  onMouseDown: MouseEventHandler<HTMLDivElement>;
  onPinToggle: () => void;
  onResetPosition: () => void;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  className?: string;
}

export default function FloatingPanelFrame({
  panelRef,
  position,
  isDragging,
  isPinned,
  onMouseDown,
  onPinToggle,
  onResetPosition,
  onClose,
  title,
  children,
  className = '',
}: FloatingPanelFrameProps) {
  return (
    <div
      ref={panelRef}
      className={`vgen-floating-panel${className ? ` ${className}` : ''} ${isDragging ? 'dragging' : ''} ${isPinned ? 'pinned' : ''}`}
      style={{
        left: position.x,
        top: position.y,
        cursor: isDragging ? 'grabbing' : 'default',
      }}
    >
      <div className="vgen-floating-panel-header" onMouseDown={onMouseDown}>
        <div className="vgen-floating-panel-title">{title}</div>
        <div className="vgen-floating-panel-actions">
          <WithHoverTooltip label={isPinned ? 'Desfijar posición' : 'Fijar posición'} placement="bottom">
            <button
              className="vgen-floating-panel-btn pin"
              onClick={onPinToggle}
              aria-label={isPinned ? 'Desfijar posición' : 'Fijar posición'}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill={isPinned ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
                <path d="M12 17v5" />
                <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4.76z" />
              </svg>
            </button>
          </WithHoverTooltip>
          {!isPinned && (
            <WithHoverTooltip label="Restablecer posición" placement="bottom">
              <button
                className="vgen-floating-panel-btn reset"
                onClick={onResetPosition}
                aria-label="Restablecer posición"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                  <path d="M3 3v5h5" />
                </svg>
              </button>
            </WithHoverTooltip>
          )}
          <WithHoverTooltip label="Cerrar panel" placement="bottom">
            <button className="vgen-floating-panel-btn close" onClick={onClose} aria-label="Cerrar panel">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18" />
                <path d="M6 6l12 12" />
              </svg>
            </button>
          </WithHoverTooltip>
        </div>
      </div>

      {children}

      <div className="vgen-floating-panel-drag-hint">
        {isDragging ? 'Suelta para fijar' : 'Arrastra para mover'}
      </div>
    </div>
  );
}
