import StatusPicker from '../StatusPicker';
import type { BoardColumn, Tarea, TeamMember } from '../../types';
import { formatDisplayDate } from '../../utils/dates';
import { isOverdue } from '../../utils/filters';
import { memberLabel } from '../../utils/members';
import { TaskRowActions, TaskSelectCheckbox } from './TaskRowPrimitives';
import Button from '@/components/ui/Button';

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

  const actions = <TaskRowActions tarea={tarea} onEdit={onEdit} onDelete={onDelete} />;

  return (
    <>
      {selectable ? (
        <Cell className={isTable ? 'px-3 py-3' : 'px-1'}>
          <TaskSelectCheckbox tarea={tarea} selected={selected} onToggle={onToggleSelect} />
        </Cell>
      ) : (
        !isTable && <span />
      )}
      <Cell className={isTable ? 'px-4 py-3' : undefined}>
        <Button variant="none" size="none"
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
        </Button>
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
