import { WithHoverTooltip } from '@/components/ui/HoverTooltip';
import { Pencil, Trash2 } from 'lucide-react';
import StatusPicker from '../StatusPicker';
import type { BoardColumn, Tarea, TeamMember } from '../../types';
import { formatDisplayDate } from '../../utils/dates';
import { isOverdue } from '../../utils/filters';
import { memberLabel } from '../../utils/members';

interface ListTaskRowContentProps {
  variant: 'grid' | 'table';
  tarea: Tarea;
  members: TeamMember[];
  columns: BoardColumn[];
  selectedIds?: Set<string>;
  selectable: boolean;
  onToggleSelect?: (id: string) => void;
  onStatusChange: (id: string, status: Tarea['status']) => void;
  onEdit?: (tarea: Tarea) => void;
  onDelete: (id: string) => void;
}

export default function ListTaskRowContent({
  variant,
  tarea,
  members,
  columns,
  selectedIds,
  selectable,
  onToggleSelect,
  onStatusChange,
  onEdit,
  onDelete,
}: ListTaskRowContentProps) {
  const isTable = variant === 'table';
  const Cell = isTable ? 'td' : 'div';
  const overdue = isOverdue(tarea, columns);
  const selected = selectedIds?.has(tarea.id) ?? false;

  const actions = (
    <>
      {onEdit && (
        <WithHoverTooltip label="Editar" placement="bottom">
          <button
            type="button"
            onClick={() => onEdit(tarea)}
            className="rounded-md p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
            aria-label={`Editar ${tarea.title}`}
          >
            <Pencil className="h-4 w-4" />
          </button>
        </WithHoverTooltip>
      )}
      <WithHoverTooltip label="Eliminar" placement="bottom">
        <button
          type="button"
          onClick={() => onDelete(tarea.id)}
          className="rounded-md p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--accent-red)]"
          aria-label={`Eliminar ${tarea.title}`}
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </WithHoverTooltip>
    </>
  );

  return (
    <>
      {selectable ? (
        <Cell className={isTable ? 'px-3 py-3' : 'px-1'}>
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggleSelect?.(tarea.id)}
            aria-label={`Seleccionar ${tarea.title}`}
            className="h-3.5 w-3.5 rounded border-[var(--border-subtle)] accent-[var(--accent-primary)]"
          />
        </Cell>
      ) : (
        !isTable && <span />
      )}
      <Cell className={isTable ? 'px-4 py-3' : undefined}>
        <button
          type="button"
          className={isTable ? 'text-left' : 'min-w-0 text-left'}
          onClick={() => onEdit?.(tarea)}
          onDoubleClick={isTable ? () => onEdit?.(tarea) : undefined}
        >
          <div
            className={`${isTable ? '' : 'truncate '}font-medium text-[var(--text-primary)] hover:text-[var(--accent-primary)]`}
          >
            {tarea.title}
          </div>
          {tarea.description && (
            <div className="mt-0.5 line-clamp-1 text-xs text-[var(--text-muted)]">{tarea.description}</div>
          )}
        </button>
      </Cell>
      <Cell className={isTable ? 'px-4 py-3' : undefined}>
        <StatusPicker
          value={tarea.status}
          columns={columns}
          onChange={(status) => onStatusChange(tarea.id, status)}
          label={`Cambiar estado de ${tarea.title}`}
          size="sm"
        />
      </Cell>
      <Cell className={`${isTable ? 'px-4 py-3' : 'truncate text-sm'} text-[var(--text-secondary)]`}>
        {memberLabel(members, tarea.assignee_id)}
      </Cell>
      <Cell
        className={`${isTable ? 'px-4 py-3' : 'text-sm'} ${
          overdue ? 'font-medium text-[var(--accent-red)]' : 'text-[var(--text-secondary)]'
        }`}
      >
        {formatDisplayDate(tarea.due_date)}
      </Cell>
      {isTable ? (
        <Cell className="px-4 py-3">
          <div className="flex items-center justify-end gap-0.5">{actions}</div>
        </Cell>
      ) : (
        <Cell className="flex items-center justify-end gap-0.5">{actions}</Cell>
      )}
    </>
  );
}
