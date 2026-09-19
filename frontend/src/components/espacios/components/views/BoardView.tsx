import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { GripVertical, LayoutGrid } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import EmptyState from '../EmptyState';
import type { BoardColumn, Tarea, TareaStatus, TeamMember } from '../../types';
import {
  buildBoardItems,
  computeInsertSortOrder,
  findContainer,
  type BoardItems,
} from '../../utils/boardLayout';
import {
  parseColumnDropId,
  visibleBoardColumns,
} from '../../utils/statusConfig';
import { Column, AddColumnCard } from './BoardColumn';
import { TaskCard } from './BoardTaskCard';

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
  onAddTask?: (status?: TareaStatus) => void;
  onAddColumn?: (name: string) => Promise<void>;
  onRenameColumn?: (id: string, name: string) => Promise<void>;
  onDeleteColumn?: (id: string) => Promise<void>;
}

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
