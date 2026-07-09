import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  pointerWithin,
  rectIntersection,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  Calendar,
  Flag,
  GripVertical,
  LayoutGrid,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
  User,
  type LucideIcon,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import EmptyState from '../EmptyState';
import StatusPicker from '../StatusPicker';
import TaskCardActions from '../TaskCardActions';
import type { BoardColumn, Tarea, TareaStatus, TeamMember } from '../../types';
import {
  buildBoardItems,
  computeInsertSortOrder,
  findContainer,
  type BoardItems,
} from '../../utils/boardLayout';
import { formatRelativeDate } from '../../utils/dates';
import { isOverdue } from '../../utils/filters';
import { memberName } from '../../utils/members';
import {
  columnDropId,
  columnIsDone,
  columnPillFilled,
  parseColumnDropId,
  softColor,
  visibleBoardColumns,
} from '../../utils/statusConfig';

interface BoardViewProps {
  tareas: Tarea[];
  members: TeamMember[];
  columns: BoardColumn[];
  showClosed: boolean;
  projectName?: string | null;
  onStatusChange: (id: string, status: TareaStatus, sortOrder: number) => void;
  onEditTask?: (tarea: Tarea) => void;
  onCompleteTask?: (tarea: Tarea) => void;
  onDeleteTask?: (tarea: Tarea) => void;
  /** Prefill status when creating from a column. */
  onAddTask?: (status?: TareaStatus) => void;
  onAddColumn?: (name: string) => Promise<void>;
  onRenameColumn?: (id: string, name: string) => Promise<void>;
  onDeleteColumn?: (id: string) => Promise<void>;
}

/** Prefer pointer-over targets; fall back so empty columns still receive drops. */
const boardCollisionDetection: CollisionDetection = (args) => {
  const pointerHits = pointerWithin(args);
  if (pointerHits.length > 0) {
    const overTask = pointerHits.find((c) => !String(c.id).startsWith('column:'));
    return overTask ? [overTask] : pointerHits;
  }

  const rectHits = rectIntersection(args);
  if (rectHits.length > 0) {
    const overTask = rectHits.find((c) => !String(c.id).startsWith('column:'));
    return overTask ? [overTask] : rectHits;
  }

  return closestCorners(args);
};

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

function TaskCard({
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
        isOverlay ? 'rotate-[1.5deg] opacity-95 shadow-xl ring-1 ring-[var(--accent-primary)]/25' : ''
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
            <p className="mt-0.5 line-clamp-1 text-[11px] text-[var(--text-muted)]/80">{tarea.description}</p>
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

function SortableTaskCard({
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
          <button
            type="button"
            className="mt-0.5 shrink-0 cursor-grab rounded-md p-0.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-input)] hover:text-[var(--text-secondary)] active:cursor-grabbing"
            aria-label={`Arrastrar «${tarea.title}»`}
            title="Arrastrar a otra columna"
            {...attributes}
            {...listeners}
          >
            <GripVertical className="h-4 w-4" strokeWidth={2} />
          </button>
        }
      />
    </div>
  );
}

function StatusPill({ column, count }: { column: BoardColumn; count: number }) {
  const color = column.color;
  const filled = columnPillFilled([column], column.key);

  return (
    <div className="flex min-w-0 items-center gap-2">
      <span
        className="inline-flex max-w-full items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide"
        style={
          filled
            ? { background: color, color: '#fff' }
            : {
                background: softColor(color),
                color,
                boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${color} 35%, transparent)`,
              }
        }
      >
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={
            filled
              ? { background: 'rgba(255,255,255,0.92)' }
              : { boxShadow: `inset 0 0 0 1.5px ${color}`, background: 'transparent' }
          }
          aria-hidden
        />
        <span className="truncate">{column.name}</span>
        <span className={filled ? 'opacity-90' : 'opacity-70'}>{count}</span>
      </span>
    </div>
  );
}

function ColumnMenu({
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
      setError(err instanceof Error ? err.message : 'No se pudo renombrar');
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
      setError(err instanceof Error ? err.message : 'No se pudo eliminar');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
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
      </button>
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
                <button
                  type="button"
                  disabled={busy || !name.trim()}
                  onClick={() => void submitRename()}
                  className="rounded-md bg-[var(--accent-primary)] px-2 py-1 text-[11px] font-medium text-[var(--text-on-accent)] disabled:opacity-50"
                >
                  Guardar
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setRenaming(false);
                    setName(column.name);
                    setError(null);
                  }}
                  className="rounded-md px-2 py-1 text-[11px] text-[var(--text-muted)] hover:bg-[var(--bg-input)]"
                >
                  Cancelar
                </button>
              </div>
            </div>
          ) : (
            <>
              {onRename && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => setRenaming(true)}
                  className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-input)] hover:text-[var(--text-primary)]"
                >
                  <Pencil className="h-3.5 w-3.5" />
                  Renombrar
                </button>
              )}
              {onDelete && !column.is_system && (
                <button
                  type="button"
                  role="menuitem"
                  disabled={busy || taskCount > 0}
                  onClick={() => void submitDelete()}
                  className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs text-[var(--accent-red)] hover:bg-[var(--accent-red)]/10 disabled:opacity-50"
                  title={
                    taskCount > 0
                      ? 'La columna debe estar vacía para eliminarla'
                      : 'Eliminar columna'
                  }
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Eliminar{taskCount > 0 ? ' (vacía primero)' : ''}
                </button>
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

function Column({
  column,
  taskIds,
  tareaById,
  allColumns,
  members,
  projectName,
  onAddTask,
  onStatusPick,
  onEditTask,
  onCompleteTask,
  onDeleteTask,
  onRenameColumn,
  onDeleteColumn,
}: {
  column: BoardColumn;
  taskIds: string[];
  tareaById: Map<string, Tarea>;
  allColumns: BoardColumn[];
  members: TeamMember[];
  projectName?: string | null;
  onAddTask?: (status?: TareaStatus) => void;
  onStatusPick: (id: string, status: TareaStatus) => void;
  onEditTask?: (tarea: Tarea) => void;
  onCompleteTask?: (tarea: Tarea) => void;
  onDeleteTask?: (tarea: Tarea) => void;
  onRenameColumn?: (id: string, name: string) => Promise<void>;
  onDeleteColumn?: (id: string) => Promise<void>;
}) {
  const dropId = columnDropId(column.key);
  const { setNodeRef, isOver } = useDroppable({
    id: dropId,
    data: { type: 'column', status: column.key },
  });
  const color = column.color;

  return (
    <div
      className="flex w-[280px] shrink-0 flex-col rounded-2xl border p-2.5 transition-colors"
      style={{
        background: isOver
          ? `color-mix(in srgb, ${color} 18%, var(--bg-base))`
          : `color-mix(in srgb, ${color} 9%, var(--bg-surface))`,
        borderColor: isOver
          ? `color-mix(in srgb, ${color} 45%, transparent)`
          : `color-mix(in srgb, ${color} 14%, var(--border-subtle))`,
      }}
    >
      <div className="mb-2.5 flex items-center justify-between gap-2 px-1 pt-0.5">
        <StatusPill column={column} count={taskIds.length} />
        <ColumnMenu
          column={column}
          taskCount={taskIds.length}
          onRename={onRenameColumn}
          onDelete={onDeleteColumn}
        />
      </div>

      <div
        ref={setNodeRef}
        className="flex min-h-[160px] flex-1 flex-col gap-2 overflow-y-auto rounded-xl p-0.5"
        data-status={column.key}
      >
        <SortableContext items={taskIds} strategy={verticalListSortingStrategy} id={dropId}>
          {taskIds.map((id) => {
            const tarea = tareaById.get(id);
            if (!tarea) return null;
            return (
              <SortableTaskCard
                key={id}
                tarea={tarea}
                members={members}
                columns={allColumns}
                projectName={projectName}
                onStatusPick={(next) => onStatusPick(id, next)}
                onEdit={onEditTask ? () => onEditTask(tarea) : undefined}
                onComplete={onCompleteTask ? () => onCompleteTask(tarea) : undefined}
                onDelete={onDeleteTask ? () => onDeleteTask(tarea) : undefined}
                onAdd={onAddTask ? () => onAddTask(column.key) : undefined}
              />
            );
          })}
        </SortableContext>
      </div>

      {onAddTask && (
        <button
          type="button"
          onClick={() => onAddTask(column.key)}
          className="mt-2 flex items-center gap-1 rounded-lg px-2 py-1.5 text-left text-[12px] font-medium transition-colors hover:bg-[var(--bg-elevated)]/70"
          style={{ color }}
        >
          <Plus className="h-3.5 w-3.5 shrink-0" strokeWidth={2.25} />
          Añadir Tarea
        </button>
      )}
    </div>
  );
}

function AddColumnCard({ onAdd }: { onAdd: (name: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
      setError(null);
    }
  }, [open]);

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onAdd(trimmed);
      setName('');
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear la columna');
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-fit w-[260px] shrink-0 items-center gap-2 rounded-2xl border border-dashed border-[var(--border-medium)] bg-[var(--bg-surface)]/60 px-4 py-3 text-left text-[13px] font-medium text-[var(--text-muted)] transition-colors hover:border-[var(--accent-primary)]/40 hover:bg-[var(--bg-elevated)] hover:text-[var(--text-secondary)]"
      >
        <Plus className="h-4 w-4 shrink-0" strokeWidth={2.25} />
        Agregar tablero
      </button>
    );
  }

  return (
    <div className="flex w-[260px] shrink-0 flex-col gap-2 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3 shadow-sm">
      <label className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
        Nueva columna
      </label>
      <input
        ref={inputRef}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void submit();
          }
          if (e.key === 'Escape') {
            setOpen(false);
            setName('');
            setError(null);
          }
        }}
        placeholder="Ej. En revisión"
        disabled={saving}
        className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-input)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--accent-primary)] focus:shadow-[0_0_0_3px_var(--accent-primary-glow)]"
        aria-label="Nombre de la columna"
      />
      {error && <p className="text-[11px] text-[var(--accent-red)]">{error}</p>}
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={saving || !name.trim()}
          onClick={() => void submit()}
          className="rounded-lg bg-[var(--accent-primary)] px-3 py-1.5 text-[12px] font-medium text-[var(--text-on-accent)] transition-colors hover:bg-[var(--accent-primary-hover)] disabled:opacity-50"
        >
          {saving ? 'Creando…' : 'Crear'}
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={() => {
            setOpen(false);
            setName('');
            setError(null);
          }}
          className="rounded-lg px-3 py-1.5 text-[12px] font-medium text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-input)] hover:text-[var(--text-secondary)]"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}

export default function BoardView({
  tareas,
  members,
  columns: allColumns,
  showClosed,
  projectName,
  onStatusChange,
  onEditTask,
  onCompleteTask,
  onDeleteTask,
  onAddTask,
  onAddColumn,
  onRenameColumn,
  onDeleteColumn,
}: BoardViewProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
  );

  const columns = useMemo(
    () => visibleBoardColumns(allColumns, showClosed),
    [allColumns, showClosed],
  );
  const columnKeys = useMemo(() => columns.map((c) => c.key), [columns]);

  const tareaById = useMemo(() => new Map(tareas.map((t) => [t.id, t])), [tareas]);

  const [items, setItems] = useState<BoardItems>(() => buildBoardItems(tareas, columnKeys));
  const itemsRef = useRef(items);
  itemsRef.current = items;

  // Sync from props when not dragging (avoid fighting local DnD state).
  useEffect(() => {
    if (activeId) return;
    setItems(buildBoardItems(tareas, columnKeys));
  }, [tareas, columnKeys, activeId]);

  const activeTarea = activeId ? tareaById.get(activeId) ?? null : null;

  const persistMove = useCallback(
    (tareaId: string, targetStatus: TareaStatus, overId: string | null) => {
      const sortOrder = computeInsertSortOrder(
        itemsRef.current,
        tareaById,
        targetStatus,
        tareaId,
        overId,
      );
      const current = tareaById.get(tareaId);
      if (!current) return;
      if (current.status === targetStatus && Math.abs(current.sort_order - sortOrder) < 0.0001) return;
      onStatusChange(tareaId, targetStatus, sortOrder);
    },
    [onStatusChange, tareaById],
  );

  const handleStatusPick = useCallback(
    (id: string, status: TareaStatus) => {
      const current = tareaById.get(id);
      if (!current || current.status === status) return;
      const lastInCol = itemsRef.current[status]?.[itemsRef.current[status].length - 1];
      const last = lastInCol ? tareaById.get(lastInCol) : null;
      onStatusChange(id, status, (last?.sort_order ?? Date.now()) + 1);
    },
    [onStatusChange, tareaById],
  );

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(String(event.active.id));
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    if (!over) return;

    const activeTaskId = String(active.id);
    const overId = String(over.id);

    const activeContainer = findContainer(itemsRef.current, activeTaskId);
    const overContainer = findContainer(itemsRef.current, overId);
    if (!activeContainer || !overContainer || activeContainer === overContainer) return;

    setItems((prev) => {
      const activeItems = prev[activeContainer];
      const overItems = prev[overContainer];
      if (!activeItems?.includes(activeTaskId)) return prev;

      const activeIndex = activeItems.indexOf(activeTaskId);
      let newIndex: number;
      const overColumn = parseColumnDropId(overId);
      if (overColumn) {
        newIndex = overItems.length + 1;
      } else {
        const overIndex = overItems.indexOf(overId);
        newIndex = overIndex >= 0 ? overIndex : overItems.length;
      }

      const nextActive = [...activeItems];
      nextActive.splice(activeIndex, 1);
      const nextOver = [...overItems];
      nextOver.splice(newIndex, 0, activeTaskId);

      return {
        ...prev,
        [activeContainer]: nextActive,
        [overContainer]: nextOver,
      };
    });
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    const tareaId = String(active.id);
    setActiveId(null);

    if (!over) {
      setItems(buildBoardItems(tareas, columnKeys));
      return;
    }

    const overId = String(over.id);
    const targetStatus = findContainer(itemsRef.current, overId) ?? findContainer(itemsRef.current, tareaId);
    if (!targetStatus) {
      setItems(buildBoardItems(tareas, columnKeys));
      return;
    }

    setItems((prev) => {
      const from = findContainer(prev, tareaId);
      if (!from) return prev;
      if (from === targetStatus) {
        const list = [...prev[targetStatus]];
        const oldIndex = list.indexOf(tareaId);
        const overTaskId = parseColumnDropId(overId) ? null : overId;
        const newIndex = overTaskId && list.includes(overTaskId) ? list.indexOf(overTaskId) : list.length - 1;
        if (oldIndex < 0 || oldIndex === newIndex) return prev;
        list.splice(oldIndex, 1);
        list.splice(newIndex, 0, tareaId);
        return { ...prev, [targetStatus]: list };
      }
      return prev;
    });

    persistMove(tareaId, targetStatus, parseColumnDropId(overId) ? null : overId);
  };

  const handleDragCancel = () => {
    setActiveId(null);
    setItems(buildBoardItems(tareas, columnKeys));
  };

  if (columns.length === 0 && !onAddColumn) {
    return (
      <EmptyState
        icon={LayoutGrid}
        title="Tablero vacío"
        description="No hay columnas configuradas para este proyecto."
      />
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={boardCollisionDetection}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className="flex h-full min-h-0 gap-3 overflow-x-auto px-4 pb-4 pt-2">
        {columns.map((column) => (
          <Column
            key={column.id || column.key}
            column={column}
            taskIds={items[column.key] ?? []}
            tareaById={tareaById}
            allColumns={allColumns}
            members={members}
            projectName={projectName}
            onAddTask={onAddTask}
            onStatusPick={handleStatusPick}
            onEditTask={onEditTask}
            onCompleteTask={onCompleteTask}
            onDeleteTask={onDeleteTask}
            onRenameColumn={onRenameColumn}
            onDeleteColumn={onDeleteColumn}
          />
        ))}
        {onAddColumn && <AddColumnCard onAdd={onAddColumn} />}
      </div>
      <DragOverlay dropAnimation={null}>
        {activeTarea ? (
          <div className="w-[256px]">
            <TaskCard
              tarea={activeTarea}
              members={members}
              columns={allColumns}
              projectName={projectName}
              isOverlay
              dragHandle={
                <span className="mt-0.5 shrink-0 p-0.5 text-[var(--text-muted)]">
                  <GripVertical className="h-4 w-4" />
                </span>
              }
            />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
