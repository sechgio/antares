import { ListTodo } from 'lucide-react';
import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { List } from 'react-window';
import EmptyState from '../EmptyState';
import type { BoardColumn, Tarea, TeamMember } from '../../types';
import { isOverdue } from '../../utils/filters';
import ListTaskRowContent from './ListTaskRowContent';
import { ESPACIOS_VIRTUALIZE_THRESHOLD, LIST_ROW_HEIGHT } from './virtualizeConfig';

interface ListViewProps {
  tareas: Tarea[];
  members: TeamMember[];
  columns?: BoardColumn[];
  selectedIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
  onToggleSelectAll?: () => void;
  onStatusChange: (id: string, status: Tarea['status']) => void;
  onEdit?: (tarea: Tarea) => void;
  onDelete: (id: string) => void;
  onAddTask?: () => void;
}

const ROW_GRID =
  'grid grid-cols-[auto_minmax(180px,2fr)_140px_140px_120px_88px] items-center gap-2 min-w-[720px]';

type RowData = {
  tareas: Tarea[];
  members: TeamMember[];
  columns: BoardColumn[];
  selectedIds?: Set<string>;
  selectable: boolean;
  onToggleSelect?: (id: string) => void;
  onStatusChange: (id: string, status: Tarea['status']) => void;
  onEdit?: (tarea: Tarea) => void;
  onDelete: (id: string) => void;
};

type RowComponentProps = {
  ariaAttributes: { 'aria-posinset': number; 'aria-setsize': number; role: 'listitem' };
  index: number;
  style: React.CSSProperties;
} & RowData;

const ListVirtualRow = React.memo(function ListVirtualRow({
  index,
  style,
  tareas,
  members,
  columns,
  selectedIds,
  selectable,
  onToggleSelect,
  onStatusChange,
  onEdit,
  onDelete,
}: RowComponentProps) {
  const tarea = tareas[index];
  if (!tarea) return <div style={style} />;
  const overdue = isOverdue(tarea, columns);
  const selected = selectedIds?.has(tarea.id) ?? false;

  return (
    <div
      style={style}
      className={`${ROW_GRID} border-b border-[var(--border-subtle)] px-3 transition-colors hover:bg-[var(--bg-elevated)]/50 ${
        overdue ? 'bg-[var(--accent-red)]/[0.03]' : ''
      } ${selected ? 'bg-[var(--accent-primary)]/[0.06]' : ''}`}
      data-virtual-row
    >
      <ListTaskRowContent
        variant="grid"
        tarea={tarea}
        members={members}
        columns={columns}
        selectedIds={selectedIds}
        selectable={selectable}
        onToggleSelect={onToggleSelect}
        onStatusChange={onStatusChange}
        onEdit={onEdit}
        onDelete={onDelete}
      />
    </div>
  );
});

function ListRowTable({
  tareas,
  members,
  columns,
  selectedIds,
  selectable,
  allSelected,
  someSelected,
  onToggleSelect,
  onToggleSelectAll,
  onStatusChange,
  onEdit,
  onDelete,
}: {
  tareas: Tarea[];
  members: TeamMember[];
  columns: BoardColumn[];
  selectedIds?: Set<string>;
  selectable: boolean;
  allSelected: boolean;
  someSelected: boolean;
  onToggleSelect?: (id: string) => void;
  onToggleSelectAll?: () => void;
  onStatusChange: (id: string, status: Tarea['status']) => void;
  onEdit?: (tarea: Tarea) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="overflow-x-auto px-2">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead>
          <tr className="border-b border-[var(--border-subtle)] text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
            {selectable && (
              <th className="w-10 px-3 py-3">
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = someSelected && !allSelected;
                  }}
                  onChange={() => onToggleSelectAll?.()}
                  aria-label="Seleccionar todas las tareas"
                  className="h-3.5 w-3.5 rounded border-[var(--border-subtle)] accent-[var(--accent-primary)]"
                />
              </th>
            )}
            <th className="px-4 py-3 font-medium">Tarea</th>
            <th className="px-4 py-3 font-medium">Estado</th>
            <th className="px-4 py-3 font-medium">Asignado</th>
            <th className="px-4 py-3 font-medium">Vencimiento</th>
            <th className="w-10 px-4 py-3 font-medium" />
          </tr>
        </thead>
        <tbody>
          {tareas.map((tarea) => {
            const overdue = isOverdue(tarea, columns);
            const selected = selectedIds?.has(tarea.id) ?? false;
            return (
              <tr
                key={tarea.id}
                className={`border-b border-[var(--border-subtle)] transition-colors hover:bg-[var(--bg-elevated)]/50 ${
                  overdue ? 'bg-[var(--accent-red)]/[0.03]' : ''
                } ${selected ? 'bg-[var(--accent-primary)]/[0.06]' : ''}`}
              >
                <ListTaskRowContent
                  variant="table"
                  tarea={tarea}
                  members={members}
                  columns={columns}
                  selectedIds={selectedIds}
                  selectable={selectable}
                  onToggleSelect={onToggleSelect}
                  onStatusChange={onStatusChange}
                  onEdit={onEdit}
                  onDelete={onDelete}
                />
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function ListView({
  tareas,
  members,
  columns = [],
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  onStatusChange,
  onEdit,
  onDelete,
  onAddTask,
}: ListViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [listHeight, setListHeight] = useState(0);

  const useVirtual = tareas.length >= ESPACIOS_VIRTUALIZE_THRESHOLD;

  useLayoutEffect(() => {
    if (!useVirtual) return;
    const el = containerRef.current;
    if (!el) return;
    const update = () => setListHeight(Math.floor(el.getBoundingClientRect().height));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [useVirtual]);

  const selectable = Boolean(onToggleSelect);
  const allSelected = selectable && tareas.length > 0 && tareas.every((t) => selectedIds?.has(t.id));
  const someSelected = selectable && tareas.some((t) => selectedIds?.has(t.id));

  const rowProps = useMemo<RowData>(
    () => ({
      tareas,
      members,
      columns,
      selectedIds,
      selectable,
      onToggleSelect,
      onStatusChange,
      onEdit,
      onDelete,
    }),
    [tareas, members, columns, selectedIds, selectable, onToggleSelect, onStatusChange, onEdit, onDelete],
  );

  if (tareas.length === 0) {
    return (
      <EmptyState
        icon={ListTodo}
        title="Sin tareas"
        description="Crea tareas para organizar el trabajo de tu proyecto. Puedes asignarlas, fecharlas y cambiar su estado."
        actionLabel={onAddTask ? 'Nueva tarea' : undefined}
        onAction={onAddTask}
      />
    );
  }

  if (!useVirtual) {
    return (
      <ListRowTable
        tareas={tareas}
        members={members}
        columns={columns}
        selectedIds={selectedIds}
        selectable={selectable}
        allSelected={allSelected}
        someSelected={someSelected}
        onToggleSelect={onToggleSelect}
        onToggleSelectAll={onToggleSelectAll}
        onStatusChange={onStatusChange}
        onEdit={onEdit}
        onDelete={onDelete}
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col px-2" data-virtualized-list>
      <div className={`${ROW_GRID} shrink-0 border-b border-[var(--border-subtle)] px-3 py-3 text-[11px] uppercase tracking-wide text-[var(--text-muted)]`}>
        {selectable ? (
          <div className="px-1">
            <input
              type="checkbox"
              checked={allSelected}
              ref={(el) => {
                if (el) el.indeterminate = someSelected && !allSelected;
              }}
              onChange={() => onToggleSelectAll?.()}
              aria-label="Seleccionar todas las tareas"
              className="h-3.5 w-3.5 rounded border-[var(--border-subtle)] accent-[var(--accent-primary)]"
            />
          </div>
        ) : (
          <span />
        )}
        <span className="font-medium">Tarea</span>
        <span className="font-medium">Estado</span>
        <span className="font-medium">Asignado</span>
        <span className="font-medium">Vencimiento</span>
        <span />
      </div>
      <div ref={containerRef} className="min-h-0 flex-1 overflow-x-auto">
        {listHeight > 0 && (
          <List
            rowCount={tareas.length}
            rowHeight={LIST_ROW_HEIGHT}
            defaultHeight={listHeight}
            overscanCount={8}
            rowComponent={ListVirtualRow as (props: RowComponentProps) => React.ReactElement | null}
            rowProps={rowProps}
            style={{ height: listHeight, width: '100%' }}
          />
        )}
      </div>
    </div>
  );
}
