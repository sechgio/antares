import { useEffect, useRef, useState } from 'react';
import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { WithHoverTooltip } from '@/components/ui/HoverTooltip';
import Button from '@/components/ui/Button';
import { errorMessage } from '@/utils/errors';
import type { BoardColumn } from '../../types';
export function ColumnMenu({
  column,
  taskCount,
  onRename,
  onDelete,
}: {
  column: BoardColumn;
  taskCount: number;
  onRename?: (id: string, name: string) => Promise<void>;
  onDelete?: (id: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(column.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setName(column.name);
  }, [column.name]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setRenaming(false);
        setError(null);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        setRenaming(false);
        setError(null);
      }
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!onRename && !onDelete) return null;

  const submitRename = async () => {
    const trimmed = name.trim();
    if (!trimmed || !onRename || busy) return;
    if (trimmed === column.name) {
      setRenaming(false);
      setOpen(false);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onRename(column.id, trimmed);
      setRenaming(false);
      setOpen(false);
    } catch (err) {
      setError(errorMessage(err, 'No se pudo renombrar'));
    } finally {
      setBusy(false);
    }
  };

  const submitDelete = async () => {
    if (!onDelete || busy || column.is_system) return;
    setBusy(true);
    setError(null);
    try {
      await onDelete(column.id);
      setOpen(false);
    } catch (err) {
      setError(errorMessage(err, 'No se pudo eliminar'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div ref={rootRef} className="relative shrink-0">
      <Button variant="none" size="none"
        onClick={() => {
          setOpen((v) => !v);
          setRenaming(false);
          setError(null);
          setName(column.name);
        }}
        className="rounded-md p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-secondary)]"
        aria-label={`Opciones de columna ${column.name}`}
        aria-expanded={open}
      >
        <MoreHorizontal className="h-4 w-4" />
      </Button>
      {open && (
        <div
          className="absolute right-0 top-full z-30 mt-1 min-w-[180px] rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-1 shadow-lg"
          role="menu"
        >
          {renaming ? (
            <div className="space-y-1.5 p-1.5">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void submitRename();
                  }
                }}
                disabled={busy}
                className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-input)] px-2 py-1.5 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent-primary)]"
                aria-label="Nuevo nombre de columna"
                autoFocus
              />
              <div className="flex gap-1">
                <Button variant="none" size="none"
                  disabled={busy || !name.trim()}
                  onClick={() => void submitRename()}
                  className="rounded-md bg-[var(--accent-primary)] px-2 py-1 text-[11px] font-medium text-[var(--text-on-accent)] disabled:opacity-50"
                >
                  Guardar
                </Button>
                <Button variant="none" size="none"
                  disabled={busy}
                  onClick={() => {
                    setRenaming(false);
                    setName(column.name);
                    setError(null);
                  }}
                  className="rounded-md px-2 py-1 text-[11px] text-[var(--text-muted)] hover:bg-[var(--bg-input)]"
                >
                  Cancelar
                </Button>
              </div>
            </div>
          ) : (
            <>
              {onRename && (
                <Button variant="none" size="none"
                  role="menuitem"
                  onClick={() => setRenaming(true)}
                  className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-input)] hover:text-[var(--text-primary)]"
                >
                  <Pencil className="h-3.5 w-3.5" />
                  Renombrar
                </Button>
              )}
              {onDelete && !column.is_system && (
                <WithHoverTooltip
                  label={
                    taskCount > 0
                      ? 'La columna debe estar vacía para eliminarla'
                      : 'Eliminar columna'
                  }
                  placement="bottom"
                  className="w-full"
                >
                  <Button variant="none" size="none"
                    role="menuitem"
                    disabled={busy || taskCount > 0}
                    onClick={() => void submitDelete()}
                    className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs text-[var(--accent-red)] hover:bg-[color:color-mix(in_srgb,var(--accent-red)_10%,transparent)] disabled:opacity-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Eliminar{taskCount > 0 ? ' (vacía primero)' : ''}
                  </Button>
                </WithHoverTooltip>
              )}
              {column.is_system && (
                <p className="px-2.5 py-1.5 text-[10px] text-[var(--text-muted)]">Columna del sistema</p>
              )}
            </>
          )}
          {error && <p className="px-2.5 pb-1.5 text-[11px] text-[var(--accent-red)]">{error}</p>}
        </div>
      )}
    </div>
  );
}

