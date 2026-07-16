import { WithHoverTooltip } from '@/components/ui/HoverTooltip';
import { Check, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

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

/**
 * Floating action strip on task cards (ClickUp-style): complete, add, edit, more.
 */
export default function TaskCardActions({
  title,
  isDone,
  onComplete,
  onAdd,
  onEdit,
  onDelete,
}: TaskCardActionsProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!menuOpen) return;

    const place = () => {
      const btn = moreRef.current;
      if (!btn) return;
      const rect = btn.getBoundingClientRect();
      const width = 160;
      const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8));
      const top = Math.min(rect.bottom + 4, window.innerHeight - 80);
      setMenuPos({ top, left });
    };
    place();

    const onPointer = (e: MouseEvent) => {
      const t = e.target as Node;
      if (moreRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [menuOpen]);

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
          onClick={() => setMenuOpen((v) => !v)}
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
                setMenuOpen(false);
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
