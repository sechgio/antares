import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { List } from 'react-window';
import { Plus } from 'lucide-react';
import Button from '@/components/ui/Button';
import { errorMessage } from '@/utils/errors';
import type { BoardColumn, Tarea, TareaStatus, TeamMember } from '../../types';
import { columnDropId, columnPillFilled, softColor } from '../../utils/statusConfig';
import { BOARD_CARD_ROW_HEIGHT, ESPACIOS_VIRTUALIZE_THRESHOLD } from './virtualizeConfig';
import { SortableTaskCard } from './BoardTaskCard';
import { ColumnMenu } from './BoardColumnMenu';

const BOARD_VIRTUALIZE_THRESHOLD = ESPACIOS_VIRTUALIZE_THRESHOLD;
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

export function Column({
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
  const useVirtual = taskIds.length >= BOARD_VIRTUALIZE_THRESHOLD;
  const listRef = useRef<HTMLDivElement>(null);
  const [listHeight, setListHeight] = useState(0);

  useLayoutEffect(() => {
    if (!useVirtual) return;
    const el = listRef.current;
    if (!el) return;
    const update = () => setListHeight(Math.floor(el.getBoundingClientRect().height));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [useVirtual, taskIds.length]);

  type BoardRowProps = {
    ariaAttributes: { 'aria-posinset': number; 'aria-setsize': number; role: 'listitem' };
    index: number;
    style: React.CSSProperties;
    taskIds: string[];
    tareaById: Map<string, Tarea>;
    members: TeamMember[];
    allColumns: BoardColumn[];
    projectName?: string | null;
    onStatusPick: (id: string, status: TareaStatus) => void;
    onEditTask?: (tarea: Tarea) => void;
    onCompleteTask?: (tarea: Tarea) => void;
    onDeleteTask?: (tarea: Tarea) => void;
    onAddTask?: (status?: TareaStatus) => void;
    columnKey: TareaStatus;
  };

  const boardRowProps = useMemo(
    () => ({
      taskIds,
      tareaById,
      members,
      allColumns,
      projectName,
      onStatusPick,
      onEditTask,
      onCompleteTask,
      onDeleteTask,
      onAddTask,
      columnKey: column.key,
    }),
    [taskIds, tareaById, members, allColumns, projectName, onStatusPick, onEditTask, onCompleteTask, onDeleteTask, onAddTask, column.key],
  );

  const BoardVirtualRow = useMemo(
    () =>
      function BoardVirtualRowInner({
        index,
        style,
        taskIds: ids,
        tareaById: byId,
        members: mems,
        allColumns: cols,
        projectName: proj,
        onStatusPick: pick,
        onEditTask: edit,
        onCompleteTask: complete,
        onDeleteTask: remove,
        onAddTask: add,
        columnKey,
      }: BoardRowProps) {
        const id = ids[index];
        const tarea = id ? byId.get(id) : undefined;
        if (!tarea) return <div style={style} />;
        return (
          <div style={style} className="px-0.5 pb-2" data-virtual-row>
            <SortableTaskCard
              tarea={tarea}
              members={mems}
              columns={cols}
              projectName={proj}
              onStatusPick={(next) => pick(id, next)}
              onEdit={edit ? () => edit(tarea) : undefined}
              onComplete={complete ? () => complete(tarea) : undefined}
              onDelete={remove ? () => remove(tarea) : undefined}
              onAdd={add ? () => add(columnKey) : undefined}
            />
          </div>
        );
      },
    [],
  );

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
      data-virtualized-board-column={useVirtual ? 'true' : 'false'}
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
        className="flex min-h-[160px] max-h-[min(70vh,640px)] flex-1 flex-col gap-2 overflow-hidden rounded-xl p-0.5"
        data-status={column.key}
      >
        <SortableContext items={taskIds} strategy={verticalListSortingStrategy} id={dropId}>
          {!useVirtual ? (
            <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
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
            </div>
          ) : (
            <div ref={listRef} className="min-h-0 flex-1">
              {listHeight > 0 && (
                <List
                  rowCount={taskIds.length}
                  rowHeight={BOARD_CARD_ROW_HEIGHT}
                  defaultHeight={listHeight}
                  overscanCount={4}
                  rowComponent={BoardVirtualRow as never}
                  rowProps={boardRowProps}
                  style={{ height: listHeight, width: '100%' }}
                />
              )}
            </div>
          )}
        </SortableContext>
      </div>

      {onAddTask && (
        <Button variant="none" size="none"
          onClick={() => onAddTask(column.key)}
          className="mt-2 flex items-center gap-1 rounded-lg px-2 py-1.5 text-left text-[12px] font-medium transition-colors hover:bg-[color:color-mix(in_srgb,var(--bg-elevated)_70%,transparent)]"
          style={{ color }}
        >
          <Plus className="h-3.5 w-3.5 shrink-0" strokeWidth={2.25} />
          Añadir Tarea
        </Button>
      )}
    </div>
  );
}

export function AddColumnCard({ onAdd }: { onAdd: (name: string) => Promise<void> }) {
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
      setError(errorMessage(err, 'No se pudo crear la columna'));
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <Button variant="none" size="none"
        onClick={() => setOpen(true)}
        className="flex h-fit w-[260px] shrink-0 items-center gap-2 rounded-2xl border border-dashed border-[var(--border-medium)] bg-[color:color-mix(in_srgb,var(--bg-surface)_60%,transparent)] px-4 py-3 text-left text-[13px] font-medium text-[var(--text-muted)] transition-colors hover:border-[color:color-mix(in_srgb,var(--accent-primary)_40%,transparent)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-secondary)]"
      >
        <Plus className="h-4 w-4 shrink-0" strokeWidth={2.25} />
        Agregar tablero
      </Button>
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
        <Button variant="none" size="none"
          disabled={saving || !name.trim()}
          onClick={() => void submit()}
          className="rounded-lg bg-[var(--accent-primary)] px-3 py-1.5 text-[12px] font-medium text-[var(--text-on-accent)] transition-colors hover:bg-[var(--accent-primary-hover)] disabled:opacity-50"
        >
          {saving ? 'Creando…' : 'Crear'}
        </Button>
        <Button variant="none" size="none"
          disabled={saving}
          onClick={() => {
            setOpen(false);
            setName('');
            setError(null);
          }}
          className="rounded-lg px-3 py-1.5 text-[12px] font-medium text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-input)] hover:text-[var(--text-secondary)]"
        >
          Cancelar
        </Button>
      </div>
    </div>
  );
}

