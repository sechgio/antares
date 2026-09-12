import { WithHoverTooltip } from '@/components/ui/HoverTooltip';
import { Check, Flag, Pencil, Trash2 } from 'lucide-react';
import StatusPicker from '../StatusPicker';
import type { BoardColumn, Tarea, TareaStatus, TeamMember } from '../../types';
import { formatRelativeDate } from '../../utils/dates';
import { isOverdue } from '../../utils/filters';
import { memberName } from '../../utils/members';
import { columnIsDone } from '../../utils/statusConfig';
import { priorityMeta } from './taskPriority';

function AssigneeCell({ members, id }: { members: TeamMember[]; id: string | null }) {
  const name = memberName(members, id);
  if (!name) {
    return <span className="text-[var(--text-muted)]">—</span>;
  }
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');

  return (
    <span className="inline-flex max-w-full items-center gap-2">
      <span
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--bg-input)] text-[10px] font-bold text-[var(--text-secondary)] ring-1 ring-[var(--border-medium)]"
        title={name}
      >
        {initials || '?'}
      </span>
      <span className="truncate text-[var(--text-secondary)]">{name}</span>
    </span>
  );
}

interface TableTaskRowContentProps {
  variant: 'grid' | 'table';
  tarea: Tarea;
  index: number;
  members: TeamMember[];
  columns: BoardColumn[];
  selectedIds?: Set<string>;
  selectable: boolean;
  onToggleSelect?: (id: string) => void;
  onStatusChange: (id: string, status: TareaStatus) => void;
  onComplete: (tarea: Tarea) => void;
  onEdit?: (tarea: Tarea) => void;
  onDelete: (id: string) => void;
}

export default function TableTaskRowContent({
  variant,
  tarea,
  index,
  members,
  columns,
  selectedIds,
  selectable,
  onToggleSelect,
  onStatusChange,
  onComplete,
  onEdit,
  onDelete,
}: TableTaskRowContentProps) {
  const isTable = variant === 'table';
  const Cell = isTable ? 'td' : 'div';
  const overdue = isOverdue(tarea, columns);
  const done = columnIsDone(columns, tarea.status);
  const priority = priorityMeta(tarea, columns);
  const selected = selectedIds?.has(tarea.id) ?? false;

  const completeButton = (
    <WithHoverTooltip label={done ? 'Reabrir' : 'Completar'} placement="bottom">
      <button
        type="button"
        onClick={() => onComplete(tarea)}
        className={`flex h-5 w-5 items-center justify-center rounded-full border transition-colors ${
          done
            ? 'border-[var(--accent-green)] bg-[var(--accent-green)] text-[var(--text-on-accent)]'
            : 'border-[var(--border-medium)] text-transparent hover:border-[var(--accent-primary)] hover:text-[var(--accent-primary)]'
        }`}
        aria-label={done ? `Reabrir «${tarea.title}»` : `Completar «${tarea.title}»`}
      >
        <Check className="h-3 w-3" strokeWidth={3} />
      </button>
    </WithHoverTooltip>
  );

  const titleButton = (
    <button
      type="button"
      className={isTable ? 'min-w-0 max-w-full text-left' : 'min-w-0 text-left'}
      onClick={() => onEdit?.(tarea)}
    >
      <span
        className={`block truncate font-medium hover:text-[var(--accent-primary)] ${
          done ? 'text-[var(--text-muted)] line-through' : 'text-[var(--text-primary)]'
        }`}
      >
        {tarea.title}
      </span>
      {isTable && tarea.description && (
        <span className="mt-0.5 block truncate text-[11px] text-[var(--text-muted)]">
          {tarea.description}
        </span>
      )}
    </button>
  );

  const statusPicker = (
    <StatusPicker
      value={tarea.status}
      columns={columns}
      onChange={(status) => onStatusChange(tarea.id, status)}
      label={`Estado de ${tarea.title}`}
      size="sm"
    />
  );

  const priorityCell = priority ? (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium" style={{ color: priority.color }}>
      <Flag className="h-3 w-3 fill-current" strokeWidth={0} aria-hidden />
      {priority.label}
    </span>
  ) : (
    <span className="text-[var(--text-muted)]">—</span>
  );

  const actions = (
    <>
      {onEdit && (
        <WithHoverTooltip label="Editar" placement="bottom">
          <button
            type="button"
            onClick={() => onEdit(tarea)}
            className="rounded-md p-1.5 text-[var(--text-muted)] hover:bg-[var(--bg-input)] hover:text-[var(--text-primary)]"
            aria-label={`Editar ${tarea.title}`}
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        </WithHoverTooltip>
      )}
      <WithHoverTooltip label="Eliminar" placement="bottom">
        <button
          type="button"
          onClick={() => onDelete(tarea.id)}
          className="rounded-md p-1.5 text-[var(--text-muted)] hover:bg-[var(--bg-input)] hover:text-[var(--accent-red)]"
          aria-label={`Eliminar ${tarea.title}`}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </WithHoverTooltip>
    </>
  );

  return (
    <>
      {selectable ? (
        <Cell className={isTable ? 'px-2 py-2.5 text-center' : 'flex justify-center'}>
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
      <Cell
        className={`${isTable ? 'px-2 py-2.5 ' : ''}text-center text-xs tabular-nums text-[var(--text-muted)]`}
      >
        {index + 1}
      </Cell>
      <Cell className={isTable ? 'px-2 py-2.5' : 'flex justify-center'}>{completeButton}</Cell>
      {isTable ? <Cell className="px-3 py-2.5">{titleButton}</Cell> : titleButton}
      {isTable ? (
        <Cell className="px-3 py-2.5">
          <AssigneeCell members={members} id={tarea.assignee_id} />
        </Cell>
      ) : (
        <AssigneeCell members={members} id={tarea.assignee_id} />
      )}
      {isTable ? <Cell className="px-3 py-2.5">{statusPicker}</Cell> : statusPicker}
      <Cell
        className={`${isTable ? 'px-3 py-2.5 ' : ''}text-xs ${
          overdue && !done ? 'font-medium text-[var(--accent-red)]' : 'text-[var(--text-secondary)]'
        }`}
      >
        {tarea.due_date ? formatRelativeDate(tarea.due_date) : '—'}
      </Cell>
      <Cell className={isTable ? 'px-3 py-2.5' : undefined}>{priorityCell}</Cell>
      {isTable ? (
        <Cell className="px-3 py-2.5">
          <div className="flex items-center justify-end gap-0.5">{actions}</div>
        </Cell>
      ) : (
        <Cell className="flex items-center justify-end gap-0.5">{actions}</Cell>
      )}
    </>
  );
}
