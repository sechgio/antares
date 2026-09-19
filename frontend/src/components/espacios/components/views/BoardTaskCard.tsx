import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Calendar, Flag, GripVertical, User, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { WithHoverTooltip } from '@/components/ui/HoverTooltip';
import Button from '@/components/ui/Button';
import StatusPicker from '../StatusPicker';
import TaskCardActions from '../TaskCardActions';
import type { BoardColumn, Tarea, TareaStatus, TeamMember } from '../../types';
import { formatRelativeDate } from '../../utils/dates';
import { isOverdue } from '../../utils/filters';
import { memberName } from '../../utils/members';
import { columnIsDone } from '../../utils/statusConfig';
function AssigneeAvatar({ name }: { name: string }) {
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
  return (
    <span
      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--bg-input)] text-[9px] font-bold tracking-tight text-[var(--text-secondary)] ring-1 ring-[var(--border-medium)]"
      title={name}
    >
      {initials || '?'}
    </span>
  );
}

function MetaRow({
  icon: Icon,
  children,
  tone = 'muted',
}: {
  icon: LucideIcon;
  children: ReactNode;
  tone?: 'muted' | 'danger' | 'warn';
}) {
  const toneClass =
    tone === 'danger'
      ? 'text-[var(--accent-red)]'
      : tone === 'warn'
        ? 'text-[var(--accent-yellow)]'
        : 'text-[var(--text-muted)]';
  return (
    <div className={`flex items-center gap-1.5 text-[11px] leading-none ${toneClass}`}>
      <Icon className="h-3 w-3 shrink-0 opacity-80" strokeWidth={2} aria-hidden />
      <span className="min-w-0 truncate">{children}</span>
    </div>
  );
}

export function TaskCard({
  tarea,
  members,
  columns,
  projectName,
  isOverlay,
  dragHandle,
  showActions,
  onStatusPick,
  onEdit,
  onComplete,
  onDelete,
  onAdd,
}: {
  tarea: Tarea;
  members: TeamMember[];
  columns: BoardColumn[];
  projectName?: string | null;
  isOverlay?: boolean;
  dragHandle?: ReactNode;
  showActions?: boolean;
  onStatusPick?: (status: TareaStatus) => void;
  onEdit?: () => void;
  onComplete?: () => void;
  onDelete?: () => void;
  onAdd?: () => void;
}) {
  const assignee = memberName(members, tarea.assignee_id);
  const overdue = isOverdue(tarea, columns);
  const location = projectName ? `En Proyectos / ${projectName}` : null;
  const isDone = columnIsDone(columns, tarea.status);

  return (
    <div
      className={`group/card relative rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3 shadow-[0_1px_2px_color-mix(in_srgb,var(--text-primary)_6%,transparent)] transition-shadow hover:border-[var(--border-medium)] hover:shadow-[0_4px_14px_color-mix(in_srgb,var(--text-primary)_8%,transparent)] ${
        isOverlay ? 'rotate-[1.5deg] opacity-95 shadow-xl ring-1 ring-[color:color-mix(in_srgb,var(--accent-primary)_25%,transparent)]' : ''
      }`}
      onDoubleClick={() => onEdit?.()}
    >
      {showActions && onEdit && onComplete && onDelete && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-20 opacity-0 transition-opacity group-hover/card:pointer-events-auto group-hover/card:opacity-100 group-focus-within/card:pointer-events-auto group-focus-within/card:opacity-100">
          <TaskCardActions
            title={tarea.title}
            isDone={isDone}
            onComplete={onComplete}
            onAdd={onAdd}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        </div>
      )}

      <div className="flex items-start gap-1.5">
        {dragHandle}
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold leading-snug text-[var(--text-primary)]">{tarea.title}</div>

          {(location || tarea.description) && (
            <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-[var(--text-muted)]">
              {location ?? tarea.description}
            </p>
          )}
          {location && tarea.description && (
            <p className="mt-0.5 line-clamp-1 text-[11px] text-[color:color-mix(in_srgb,var(--text-muted)_80%,transparent)]">{tarea.description}</p>
          )}
        </div>
      </div>

      {onStatusPick && (
        <div className="mt-2" onPointerDown={(e) => e.stopPropagation()}>
          <StatusPicker
            value={tarea.status}
            columns={columns}
            onChange={onStatusPick}
            label={`Mover «${tarea.title}» a otro estado`}
            size="sm"
          />
        </div>
      )}

      <div className="mt-2.5 flex flex-col gap-1.5">
        <MetaRow icon={User}>
          {assignee ? (
            <span className="inline-flex items-center gap-1.5">
              <AssigneeAvatar name={assignee} />
              <span className="sr-only">{assignee}</span>
            </span>
          ) : (
            <span className="opacity-50">—</span>
          )}
        </MetaRow>

        <MetaRow icon={Calendar} tone={overdue ? 'danger' : 'muted'}>
          {tarea.due_date ? (
            <span className={overdue ? 'font-medium' : ''}>{formatRelativeDate(tarea.due_date)}</span>
          ) : (
            <span className="opacity-50">—</span>
          )}
        </MetaRow>

        {(tarea.status === 'urgent' || overdue) && (
          <MetaRow icon={Flag} tone="danger">
            <span className="inline-flex items-center gap-1 font-medium">
              <span className="inline-block h-2 w-2 rounded-[2px] bg-[var(--accent-red)]" aria-hidden />
              {tarea.status === 'urgent' ? 'Urgente' : 'Atrasada'}
            </span>
          </MetaRow>
        )}
      </div>
    </div>
  );
}

export function SortableTaskCard({
  tarea,
  members,
  columns,
  projectName,
  onStatusPick,
  onEdit,
  onComplete,
  onDelete,
  onAdd,
}: {
  tarea: Tarea;
  members: TeamMember[];
  columns: BoardColumn[];
  projectName?: string | null;
  onStatusPick: (status: TareaStatus) => void;
  onEdit?: () => void;
  onComplete?: () => void;
  onDelete?: () => void;
  onAdd?: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: tarea.id,
    data: { type: 'task', status: tarea.status },
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.25 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="touch-none">
      <TaskCard
        tarea={tarea}
        members={members}
        columns={columns}
        projectName={projectName}
        onStatusPick={onStatusPick}
        showActions={!isDragging}
        onEdit={onEdit}
        onComplete={onComplete}
        onDelete={onDelete}
        onAdd={onAdd}
        dragHandle={
          <WithHoverTooltip label="Arrastrar a otra columna" placement="bottom">
            <Button variant="none" size="none"
              className="mt-0.5 shrink-0 cursor-grab rounded-md p-0.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-input)] hover:text-[var(--text-secondary)] active:cursor-grabbing"
              aria-label={`Arrastrar «${tarea.title}»`}
              {...attributes}
              {...listeners}
            >
              <GripVertical className="h-4 w-4" strokeWidth={2} />
            </Button>
          </WithHoverTooltip>
        }
      />
    </div>
  );
}
