import { Plus, Table2 } from 'lucide-react';
import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { List } from 'react-window';
import EmptyState from '../EmptyState';
import type { BoardColumn, Tarea, TareaStatus, TeamMember } from '../../types';
import { isOverdue } from '../../utils/filters';
import { memberName } from '../../utils/members';
import { columnIsDone } from '../../utils/statusConfig';
import TableTaskRowContent from './TableTaskRowContent';
import { priorityRank } from './taskPriority';
import { ESPACIOS_VIRTUALIZE_THRESHOLD, TABLE_ROW_HEIGHT } from './virtualizeConfig';

interface TableViewProps {
  tareas: Tarea[];
  members: TeamMember[];
  columns?: BoardColumn[];
  selectedIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
  onToggleSelectAll?: () => void;
  onStatusChange: (id: string, status: TareaStatus) => void;
  onComplete: (tarea: Tarea) => void;
  onEdit?: (tarea: Tarea) => void;
  onDelete: (id: string) => void;
  onAddTask?: () => void;
}

type SortKey = 'title' | 'assignee' | 'status' | 'due_date' | 'priority';
type SortDir = 'asc' | 'desc';

export default function TableView({
  tareas,
  members,
  columns = [],
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  onStatusChange,
  onComplete,
  onEdit,
  onDelete,
  onAddTask,
}: TableViewProps) {
  const [sortKey, setSortKey] = useState<SortKey>('title');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const selectable = Boolean(onToggleSelect);
  const allSelected = selectable && tareas.length > 0 && tareas.every((t) => selectedIds?.has(t.id));
  const someSelected = selectable && tareas.some((t) => selectedIds?.has(t.id));
  const containerRef = useRef<HTMLDivElement>(null);
  const [listHeight, setListHeight] = useState(0);

  const sorted = useMemo(() => {
    const list = [...tareas];
    const dir = sortDir === 'asc' ? 1 : -1;
    list.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'title':
          cmp = a.title.localeCompare(b.title, 'es');
          break;
        case 'assignee': {
          const na = memberName(members, a.assignee_id) ?? '';
          const nb = memberName(members, b.assignee_id) ?? '';
          cmp = na.localeCompare(nb, 'es');
          break;
        }
        case 'status':
          cmp = a.status.localeCompare(b.status);
          break;
        case 'due_date':
          cmp = (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999');
          break;
        case 'priority':
          cmp = priorityRank(a, columns) - priorityRank(b, columns);
          break;
        default:
          cmp = 0;
      }
      return cmp * dir;
    });
    return list;
  }, [tareas, members, columns, sortKey, sortDir]);

  const useVirtual = sorted.length >= ESPACIOS_VIRTUALIZE_THRESHOLD;

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

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const TableVirtualRow = useMemo(
    () =>
      React.memo(function TableVirtualRowInner({
        index,
        style,
        sorted: rows,
        members: mems,
        columns: cols,
        selectedIds: selected,
        selectable: canSelect,
        onToggleSelect: toggle,
        onStatusChange: setStatus,
        onComplete: complete,
        onEdit: edit,
        onDelete: remove,
      }: {
        ariaAttributes: { 'aria-posinset': number; 'aria-setsize': number; role: 'listitem' };
        index: number;
        style: React.CSSProperties;
        sorted: Tarea[];
        members: TeamMember[];
        columns: BoardColumn[];
        selectedIds?: Set<string>;
        selectable: boolean;
        onToggleSelect?: (id: string) => void;
        onStatusChange: (id: string, status: TareaStatus) => void;
        onComplete: (tarea: Tarea) => void;
        onEdit?: (tarea: Tarea) => void;
        onDelete: (id: string) => void;
      }) {
        const tarea = rows[index];
        if (!tarea) return <div style={style} />;
        const overdue = isOverdue(tarea, cols);
        const done = columnIsDone(cols, tarea.status);
        const isSelected = selected?.has(tarea.id) ?? false;
        return (
          <div
            style={style}
            data-virtual-row
            className={`grid min-w-[920px] grid-cols-[40px_40px_40px_minmax(220px,2fr)_minmax(160px,1fr)_minmax(140px,1fr)_minmax(120px,0.8fr)_minmax(110px,0.7fr)_96px] items-center gap-1 border-b border-[var(--border-subtle)] px-2 text-sm transition-colors hover:bg-[var(--bg-elevated)]/60 ${
              overdue && !done ? 'bg-[var(--accent-red)]/[0.03]' : ''
            } ${isSelected ? 'bg-[var(--accent-primary)]/[0.06]' : ''}`}
          >
            <TableTaskRowContent
              variant="grid"
              tarea={tarea}
              index={index}
              members={mems}
              columns={cols}
              selectedIds={selected}
              selectable={canSelect}
              onToggleSelect={toggle}
              onStatusChange={setStatus}
              onComplete={complete}
              onEdit={edit}
              onDelete={remove}
            />
          </div>
        );
      }),
    [],
  );

  const tableRowProps = useMemo(
    () => ({
      sorted,
      members,
      columns,
      selectedIds,
      selectable,
      onToggleSelect,
      onStatusChange,
      onComplete,
      onEdit,
      onDelete,
    }),
    [sorted, members, columns, selectedIds, selectable, onToggleSelect, onStatusChange, onComplete, onEdit, onDelete],
  );

  if (tareas.length === 0) {
    return (
      <EmptyState
        icon={Table2}
        title="Tabla vacía"
        description="La vista tabla muestra tus tareas en filas y columnas. Crea la primera para empezar."
        actionLabel={onAddTask ? 'Nueva tarea' : undefined}
        onAction={onAddTask}
      />
    );
  }

  const thBtn =
    'inline-flex items-center gap-1 font-medium text-[var(--text-muted)] transition-colors hover:text-[var(--text-secondary)]';

  return (
    <div className="flex h-full min-h-0 flex-col px-2" data-virtualized-table={useVirtual ? 'true' : 'false'}>
      <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-[var(--border-subtle)]">
        {!useVirtual ? (
        <table className="w-full min-w-[920px] border-collapse text-left text-sm">
          <thead className="sticky top-0 z-10 bg-[var(--bg-elevated)]">
            <tr className="border-b border-[var(--border-subtle)] text-[11px] uppercase tracking-wide">
              {selectable && (
                <th className="w-10 px-2 py-2.5 text-center">
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
              <th className="w-10 px-2 py-2.5 text-center font-medium text-[var(--text-muted)]">#</th>
              <th className="w-10 px-2 py-2.5" aria-label="Completar" />
              <th className="min-w-[220px] px-3 py-2.5">
                <button type="button" className={thBtn} onClick={() => toggleSort('title')}>
                  Name
                  {sortKey === 'title' && (
                    <span className="text-[10px]">{sortDir === 'asc' ? '↑' : '↓'}</span>
                  )}
                </button>
              </th>
              <th className="min-w-[160px] px-3 py-2.5">
                <button type="button" className={thBtn} onClick={() => toggleSort('assignee')}>
                  Persona asignada
                  {sortKey === 'assignee' && (
                    <span className="text-[10px]">{sortDir === 'asc' ? '↑' : '↓'}</span>
                  )}
                </button>
              </th>
              <th className="min-w-[140px] px-3 py-2.5">
                <button type="button" className={thBtn} onClick={() => toggleSort('status')}>
                  Estado
                  {sortKey === 'status' && (
                    <span className="text-[10px]">{sortDir === 'asc' ? '↑' : '↓'}</span>
                  )}
                </button>
              </th>
              <th className="min-w-[120px] px-3 py-2.5">
                <button type="button" className={thBtn} onClick={() => toggleSort('due_date')}>
                  Fecha límite
                  {sortKey === 'due_date' && (
                    <span className="text-[10px]">{sortDir === 'asc' ? '↑' : '↓'}</span>
                  )}
                </button>
              </th>
              <th className="min-w-[110px] px-3 py-2.5">
                <button type="button" className={thBtn} onClick={() => toggleSort('priority')}>
                  Prioridad
                  {sortKey === 'priority' && (
                    <span className="text-[10px]">{sortDir === 'asc' ? '↑' : '↓'}</span>
                  )}
                </button>
              </th>
              <th className="w-24 px-3 py-2.5 text-right font-medium text-[var(--text-muted)]">
                <span className="sr-only">Acciones</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((tarea, index) => {
              const overdue = isOverdue(tarea, columns);
              const done = columnIsDone(columns, tarea.status);
              const selected = selectedIds?.has(tarea.id) ?? false;

              return (
                <tr
                  key={tarea.id}
                  className={`border-b border-[var(--border-subtle)] transition-colors hover:bg-[var(--bg-elevated)]/60 ${
                    overdue && !done ? 'bg-[var(--accent-red)]/[0.03]' : ''
                  } ${selected ? 'bg-[var(--accent-primary)]/[0.06]' : ''}`}
                >
                  <TableTaskRowContent
                    variant="table"
                    tarea={tarea}
                    index={index}
                    members={members}
                    columns={columns}
                    selectedIds={selectedIds}
                    selectable={selectable}
                    onToggleSelect={onToggleSelect}
                    onStatusChange={onStatusChange}
                    onComplete={onComplete}
                    onEdit={onEdit}
                    onDelete={onDelete}
                  />
                </tr>
              );
            })}
          </tbody>
        </table>
        ) : (
          <div className="flex h-full min-h-[320px] flex-col">
            <div className="grid min-w-[920px] shrink-0 grid-cols-[40px_40px_40px_minmax(220px,2fr)_minmax(160px,1fr)_minmax(140px,1fr)_minmax(120px,0.8fr)_minmax(110px,0.7fr)_96px] items-center gap-1 border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 py-2.5 text-[11px] uppercase tracking-wide">
              {selectable ? (
                <div className="flex justify-center">
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
              <span className="text-center font-medium text-[var(--text-muted)]">#</span>
              <span />
              <button type="button" className={thBtn} onClick={() => toggleSort('title')}>
                Name
                {sortKey === 'title' && <span className="text-[10px]">{sortDir === 'asc' ? '↑' : '↓'}</span>}
              </button>
              <button type="button" className={thBtn} onClick={() => toggleSort('assignee')}>
                Persona asignada
                {sortKey === 'assignee' && <span className="text-[10px]">{sortDir === 'asc' ? '↑' : '↓'}</span>}
              </button>
              <button type="button" className={thBtn} onClick={() => toggleSort('status')}>
                Estado
                {sortKey === 'status' && <span className="text-[10px]">{sortDir === 'asc' ? '↑' : '↓'}</span>}
              </button>
              <button type="button" className={thBtn} onClick={() => toggleSort('due_date')}>
                Fecha límite
                {sortKey === 'due_date' && <span className="text-[10px]">{sortDir === 'asc' ? '↑' : '↓'}</span>}
              </button>
              <button type="button" className={thBtn} onClick={() => toggleSort('priority')}>
                Prioridad
                {sortKey === 'priority' && <span className="text-[10px]">{sortDir === 'asc' ? '↑' : '↓'}</span>}
              </button>
              <span className="sr-only">Acciones</span>
            </div>
            <div ref={containerRef} className="min-h-0 flex-1">
              {listHeight > 0 && (
                <List
                  rowCount={sorted.length}
                  rowHeight={TABLE_ROW_HEIGHT}
                  defaultHeight={listHeight}
                  overscanCount={8}
                  rowComponent={TableVirtualRow as never}
                  rowProps={tableRowProps}
                  style={{ height: listHeight, width: '100%' }}
                />
              )}
            </div>
          </div>
        )}
      </div>

      {onAddTask && (
        <button
          type="button"
          onClick={onAddTask}
          className="mt-2 inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
        >
          <Plus className="h-3.5 w-3.5" />
          Añadir tarea
        </button>
      )}
    </div>
  );
}
