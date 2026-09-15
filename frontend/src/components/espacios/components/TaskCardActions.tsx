import { WithHoverTooltip } from '@/components/ui/HoverTooltip';
import { Check, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import { useId } from 'react';
import { createPortal } from 'react-dom';
import { useAnchoredPopover } from '@/hooks/useAnchoredPopover';

interface TaskCardActionsProps {
  title: string;
  isDone: boolean;
  onComplete: () => void;
  onAdd?: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

const BTN =
  'flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-input)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]/35';

export default function TaskCardActions({
  title,
  isDone,
  onComplete,
  onAdd,
  onEdit,
  onDelete,
}: TaskCardActionsProps) {
  const {
    isOpen: menuOpen,
    position: menuPos,
    triggerRef: moreRef,
    popupRef: menuRef,
    close,
    toggle,
  } = useAnchoredPopover({
    estimatedHeight: 80,
    estimatedWidth: 160,
    align: 'end',
    direction: 'down',
    gap: 4,
  });
  const menuId = useId();

  return (
    <div
      className="absolute -top-2.5 right-2 z-20 flex items-center gap-0.5 rounded-lg border border-[var(--border-medium)] bg-[var(--bg-elevated)] p-0.5 shadow-[0_4px_14px_color-mix(in_srgb,var(--text-primary)_12%,transparent)]"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <WithHoverTooltip label={isDone ? 'Reabrir' : 'Completar'} placement="bottom">
        <button
          type="button"
          className={`${BTN} ${isDone ? 'text-[var(--accent-green,#22c55e)]' : ''}`}
          aria-label={isDone ? `Reabrir «${title}»` : `Completar «${title}»`}
          onClick={onComplete}
        >
          <Check className="h-3.5 w-3.5" strokeWidth={2.25} />
        </button>
      </WithHoverTooltip>

      {onAdd && (
        <WithHoverTooltip label="Nueva tarea" placement="bottom">
          <button type="button" className={BTN} aria-label="Nueva tarea" onClick={onAdd}>
            <Plus className="h-3.5 w-3.5" strokeWidth={2.25} />
          </button>
        </WithHoverTooltip>
      )}

      <WithHoverTooltip label="Editar" placement="bottom">
        <button
          type="button"
          className={BTN}
          aria-label={`Editar «${title}»`}
          onClick={onEdit}
        >
          <Pencil className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      </WithHoverTooltip>

      <WithHoverTooltip label="Más" placement="bottom">
        <button
          ref={moreRef}
          type="button"
          className={BTN}
          aria-label={`Más opciones de «${title}»`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-controls={menuOpen ? menuId : undefined}
          onClick={toggle}
        >
          <MoreHorizontal className="h-3.5 w-3.5" strokeWidth={2.25} />
        </button>
      </WithHoverTooltip>

      {menuOpen &&
        menuPos &&
        createPortal(
          <div
            ref={menuRef}
            id={menuId}
            role="menu"
            className="fixed z-[220] min-w-[160px] overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-1 shadow-[0_12px_40px_color-mix(in_srgb,var(--bg-base)_55%,transparent)]"
            style={{ top: menuPos.top, left: menuPos.left }}
          >
            <button
              type="button"
              role="menuitem"
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs font-medium text-[var(--accent-red)] transition-colors hover:bg-[var(--bg-base)]"
              onClick={() => {
                close();
                onDelete();
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Eliminar
            </button>
          </div>,
          document.body,
        )}
    </div>
  );
}
