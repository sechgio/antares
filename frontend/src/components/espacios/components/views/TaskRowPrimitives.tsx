import { Pencil, Trash2 } from 'lucide-react';
import { WithHoverTooltip } from '@/components/ui/HoverTooltip';
import Button from '@/components/ui/Button';
import type { Tarea } from '../../types';

export function TaskSelectCheckbox({
  tarea,
  selected,
  onToggle,
}: {
  tarea: Tarea;
  selected: boolean;
  onToggle?: (id: string) => void;
}) {
  return (
    <input
      type="checkbox"
      checked={selected}
      onChange={() => onToggle?.(tarea.id)}
      aria-label={`Seleccionar ${tarea.title}`}
      className="h-3.5 w-3.5 rounded border-[var(--border-subtle)] accent-[var(--accent-primary)]"
    />
  );
}

/**
 * Acciones editar/eliminar de las filas de tareas. `small` reproduce las
 * variantes visuales de cada vista: icono h-3.5 con hover bg-input (tabla) o
 * icono h-4 con hover bg-elevated y transition-colors (lista).
 */
export function TaskRowActions({
  tarea,
  onEdit,
  onDelete,
  small = false,
}: {
  tarea: Tarea;
  onEdit?: (tarea: Tarea) => void;
  onDelete: (id: string) => void;
  small?: boolean;
}) {
  const iconClass = small ? 'h-3.5 w-3.5' : 'h-4 w-4';
  const hoverBg = small ? 'hover:bg-[var(--bg-input)]' : 'hover:bg-[var(--bg-elevated)]';
  const motion = small ? '' : ' transition-colors';
  return (
    <>
      {onEdit && (
        <WithHoverTooltip label="Editar" placement="bottom">
          <Button variant="none" size="none"
            onClick={() => onEdit(tarea)}
            className={`rounded-md p-1.5 text-[var(--text-muted)]${motion} ${hoverBg} hover:text-[var(--text-primary)]`}
            aria-label={`Editar ${tarea.title}`}
          >
            <Pencil className={iconClass} />
          </Button>
        </WithHoverTooltip>
      )}
      <WithHoverTooltip label="Eliminar" placement="bottom">
        <Button variant="none" size="none"
          onClick={() => onDelete(tarea.id)}
          className={`rounded-md p-1.5 text-[var(--text-muted)]${motion} ${hoverBg} hover:text-[var(--accent-red)]`}
          aria-label={`Eliminar ${tarea.title}`}
        >
          <Trash2 className={iconClass} />
        </Button>
      </WithHoverTooltip>
    </>
  );
}
