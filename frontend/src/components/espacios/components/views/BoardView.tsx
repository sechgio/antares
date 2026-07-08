import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
  closestCorners,
} from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { AlertCircle, Calendar, LayoutGrid } from 'lucide-react';
import { useMemo, useState } from 'react';
import EmptyState from '../EmptyState';
import type { Tarea, TareaStatus, TeamMember } from '../../types';
import { formatDisplayDate } from '../../utils/dates';
import { isOverdue } from '../../utils/filters';
import { memberName } from '../../utils/members';
import { STATUS_ACCENT, STATUS_LABELS, STATUS_OPTIONS } from '../../utils/statusConfig';

interface BoardViewProps {
  tareas: Tarea[];
  members: TeamMember[];
  showClosed: boolean;
  onStatusChange: (id: string, status: TareaStatus, sortOrder: number) => void;
  onAddTask?: () => void;
}

function AssigneeAvatar({ name }: { name: string }) {
  const initials = name
    .split(' ')
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
  return (
    <span
      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--bg-input)] text-[9px] font-semibold text-[var(--text-secondary)]"
      title={name}
    >
      {initials}
    </span>
  );
}

function TaskCard({ tarea, members, isOverlay }: { tarea: Tarea; members: TeamMember[]; isOverlay?: boolean }) {
  const assignee = memberName(members, tarea.assignee_id);
  const overdue = isOverdue(tarea);

  return (
    <div
      className={`rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3 shadow-sm transition-shadow hover:shadow-md ${
        isOverlay ? 'rotate-1 opacity-95 shadow-lg' : ''
      }`}
      style={{ borderLeftWidth: 3, borderLeftColor: STATUS_ACCENT[tarea.status] }}
    >
      <div className="text-sm font-medium leading-snug text-[var(--text-primary)]">{tarea.title}</div>
      {tarea.description && (
        <p className="mt-1 line-clamp-2 text-xs text-[var(--text-muted)]">{tarea.description}</p>
      )}
      <div className="mt-2.5 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          {assignee && <AssigneeAvatar name={assignee} />}
          {tarea.due_date && (
            <span
              className={`flex items-center gap-1 text-[11px] ${
                overdue ? 'font-medium text-[var(--accent-red)]' : 'text-[var(--text-muted)]'
              }`}
            >
              {overdue ? <AlertCircle className="h-3 w-3 shrink-0" /> : <Calendar className="h-3 w-3 shrink-0" />}
              {formatDisplayDate(tarea.due_date)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function SortableTaskCard({ tarea, members }: { tarea: Tarea; members: TeamMember[] }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: tarea.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.35 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing">
      <TaskCard tarea={tarea} members={members} />
    </div>
  );
}

function Column({
  status,
  tareas,
  members,
}: {
  status: TareaStatus;
  tareas: Tarea[];
  members: TeamMember[];
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const ids = tareas.map((t) => t.id);

  return (
    <div
      ref={setNodeRef}
      className={`flex min-w-[240px] flex-1 flex-col rounded-xl border p-3 transition-colors ${
        isOver
          ? 'border-[var(--accent-primary)]/40 bg-[var(--accent-primary)]/5'
          : 'border-transparent bg-[var(--bg-elevated)]/40'
      }`}
    >
      <div className="mb-3 flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <span
            className="h-2 w-2 rounded-full"
            style={{ background: STATUS_ACCENT[status] }}
          />
          <span className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
            {STATUS_LABELS[status]}
          </span>
        </div>
        <span className="rounded-full bg-[var(--bg-base)] px-2 py-0.5 text-xs tabular-nums text-[var(--text-secondary)]">
          {tareas.length}
        </span>
      </div>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div className="flex min-h-[140px] flex-col gap-2">
          {tareas.map((t) => (
            <SortableTaskCard key={t.id} tarea={t} members={members} />
          ))}
        </div>
      </SortableContext>
    </div>
  );
}

export default function BoardView({ tareas, members, showClosed, onStatusChange, onAddTask }: BoardViewProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const columns = useMemo(
    () => STATUS_OPTIONS.filter((s) => showClosed || s !== 'closed'),
    [showClosed],
  );

  const byStatus = useMemo(() => {
    const map = Object.fromEntries(columns.map((s) => [s, [] as Tarea[]])) as Record<TareaStatus, Tarea[]>;
    for (const t of tareas) {
      if (map[t.status]) map[t.status].push(t);
    }
    for (const s of columns) {
      map[s].sort((a, b) => a.sort_order - b.sort_order);
    }
    return map;
  }, [tareas, columns]);

  const activeTarea = activeId ? tareas.find((t) => t.id === activeId) ?? null : null;

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(String(event.active.id));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;

    const tareaId = String(active.id);
    const tarea = tareas.find((t) => t.id === tareaId);
    if (!tarea) return;

    let targetStatus = tarea.status;
    const overId = String(over.id);
    if (columns.includes(overId as TareaStatus)) {
      targetStatus = overId as TareaStatus;
    } else {
      const overTarea = tareas.find((t) => t.id === overId);
      if (overTarea) targetStatus = overTarea.status;
    }

    const columnTasks = byStatus[targetStatus].filter((t) => t.id !== tareaId);
    let sortOrder = Date.now();
    if (overId !== targetStatus && !columns.includes(overId as TareaStatus)) {
      const overIndex = byStatus[targetStatus].findIndex((t) => t.id === overId);
      if (overIndex >= 0) {
        const prev = columnTasks[overIndex - 1];
        const next = columnTasks[overIndex];
        sortOrder = prev && next ? (prev.sort_order + next.sort_order) / 2 : next ? next.sort_order - 1 : Date.now();
      }
    }

    if (targetStatus !== tarea.status || sortOrder !== tarea.sort_order) {
      onStatusChange(tareaId, targetStatus, sortOrder);
    }
  };

  if (tareas.length === 0) {
    return (
      <EmptyState
        icon={LayoutGrid}
        title="Tablero vacío"
        description="Arrastra tareas entre columnas para cambiar su estado. Crea la primera tarea para empezar."
        actionLabel={onAddTask ? 'Nueva tarea' : undefined}
        onAction={onAddTask}
      />
    );
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="flex gap-3 overflow-x-auto px-4 pb-4 pt-1">
        {columns.map((status) => (
          <Column key={status} status={status} tareas={byStatus[status]} members={members} />
        ))}
      </div>
      <DragOverlay>{activeTarea ? <TaskCard tarea={activeTarea} members={members} isOverlay /> : null}</DragOverlay>
    </DndContext>
  );
}