import { ChevronRight, FolderKanban, Loader2, Plus, RefreshCw, SearchX } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { useDialog } from '../../hooks/useDialog';
import { useToast } from '../../hooks/useToast';
import BulkActionBar from './components/BulkActionBar';
import CreateNameModal from './components/CreateNameModal';
import EmptyState from './components/EmptyState';
import EspaciosWelcome from './components/EspaciosWelcome';
import FilterBar from './components/filters/FilterBar';
import ProjectHeader from './components/ProjectHeader';
import SpaceSidebar from './components/SpaceSidebar';
import TaskForm from './components/TaskForm';
import ViewTabs from './components/ViewTabs';
import BoardView from './components/views/BoardView';
import CalendarView from './components/views/CalendarView';
import GanttView from './components/views/GanttView';
import ListView from './components/views/ListView';
import TableView from './components/views/TableView';
import { useEspaciosSync } from './hooks/useEspaciosSync';
import { useTeamMembers } from './hooks/useTeamMembers';
import {
  DEFAULT_FILTERS,
  type Tarea,
  type TareaFilters,
  type TareaInput,
  type TareaStatus,
  type VistaType,
} from './types';
import { computeTaskStats, countActiveFilters, filterTareas } from './utils/filters';
import {
  consumeEspaciosFocusTarget,
  ESPACIOS_FOCUS_EVENT,
} from './utils/focusTarget';
import { readEspaciosPrefs, writeEspaciosPrefs } from './utils/sessionPrefs';
import {
  clampSidebarWidth,
  ESPACIOS_SIDEBAR_DEFAULT_WIDTH,
  ESPACIOS_SIDEBAR_MAX_WIDTH,
  ESPACIOS_SIDEBAR_MIN_WIDTH,
  readStoredSidebarWidth,
  writeStoredSidebarWidth,
} from './utils/sidebarWidth';

type CreateModal = 'espacio' | 'proyecto' | null;

export default function EspaciosApp() {
  const { user } = useAuth();
  const { confirm } = useDialog();
  const { addToast } = useToast();
  const sync = useEspaciosSync(user?.id);
  const { members, error: membersError } = useTeamMembers();
  const [activeView, setActiveView] = useState<VistaType>(() => readEspaciosPrefs().activeView);
  const [filters, setFilters] = useState<TareaFilters>(DEFAULT_FILTERS);
  const [taskFormOpen, setTaskFormOpen] = useState(false);
  const [editingTarea, setEditingTarea] = useState<Tarea | null>(null);
  const [createStartDate, setCreateStartDate] = useState<string | null>(null);
  const [createDueDate, setCreateDueDate] = useState<string | null>(null);
  const [createStatus, setCreateStatus] = useState<string | null>(null);
  const [createModal, setCreateModal] = useState<CreateModal>(null);
  const [sidebarWidth, setSidebarWidth] = useState(readStoredSidebarWidth);
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const sidebarWidthRef = useRef(sidebarWidth);
  const resizeStartXRef = useRef(0);
  const resizeStartWidthRef = useRef(ESPACIOS_SIDEBAR_DEFAULT_WIDTH);
  const pendingProyectoIdRef = useRef<string | null>(null);
  const pendingTareaIdRef = useRef<string | null>(null);
  const membersErrorToastedRef = useRef(false);
  const pendingDeletesRef = useRef<
    Map<string, { tarea: Tarea; timer: ReturnType<typeof setTimeout> }>
  >(new Map());
  sidebarWidthRef.current = sidebarWidth;

  const { setActiveEspacioId, setActiveProyectoId, proyectos, tareas } = sync;

  const handleViewChange = useCallback((view: VistaType) => {
    setActiveView(view);
    writeEspaciosPrefs({ activeView: view });
    setSelectedIds(new Set());
  }, []);

  // Clear selection when project changes; flush pending deletes on unmount.
  useEffect(() => {
    setSelectedIds(new Set());
  }, [sync.activeProyectoId]);

  useEffect(() => {
    const pending = pendingDeletesRef.current;
    return () => {
      for (const { timer, tarea } of pending.values()) {
        clearTimeout(timer);
        void sync.commitDeleteTarea(tarea.id).catch(() => {
          /* best-effort commit on unmount */
        });
      }
      pending.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on unmount
  }, []);

  // Surface non-fatal nested load failures without blanking the whole module.
  useEffect(() => {
    if (!sync.warning) return;
    addToast({ message: sync.warning, type: 'error' });
    sync.clearWarning();
  }, [sync.warning, sync.clearWarning, addToast]);

  useEffect(() => {
    if (!membersError || membersErrorToastedRef.current) return;
    membersErrorToastedRef.current = true;
    addToast({ message: membersError, type: 'error' });
  }, [membersError, addToast]);

  const applyFocusTarget = useCallback(() => {
    const target = consumeEspaciosFocusTarget();
    if (!target) return;
    if (target.espacioId) {
      setActiveEspacioId(target.espacioId);
    }
    pendingProyectoIdRef.current = target.proyectoId ?? null;
    pendingTareaIdRef.current = target.tareaId ?? null;
    if (target.proyectoId && proyectos.some((p) => p.id === target.proyectoId)) {
      setActiveProyectoId(target.proyectoId);
      pendingProyectoIdRef.current = null;
    }
  }, [setActiveEspacioId, setActiveProyectoId, proyectos]);

  useEffect(() => {
    applyFocusTarget();
    window.addEventListener(ESPACIOS_FOCUS_EVENT, applyFocusTarget);
    return () => window.removeEventListener(ESPACIOS_FOCUS_EVENT, applyFocusTarget);
  }, [applyFocusTarget]);

  useEffect(() => {
    const proyectoId = pendingProyectoIdRef.current;
    if (!proyectoId) return;
    if (!proyectos.some((p) => p.id === proyectoId)) return;
    setActiveProyectoId(proyectoId);
    pendingProyectoIdRef.current = null;
  }, [proyectos, setActiveProyectoId]);

  useEffect(() => {
    const tareaId = pendingTareaIdRef.current;
    if (!tareaId) return;
    const tarea = tareas.find((t) => t.id === tareaId);
    if (!tarea) return;
    pendingTareaIdRef.current = null;
    setEditingTarea(tarea);
    setCreateStartDate(null);
    setCreateDueDate(null);
    setCreateStatus(null);
    setTaskFormOpen(true);
  }, [tareas]);

  const filteredTareas = useMemo(
    () => filterTareas(sync.tareas, filters, sync.boardColumns),
    [sync.tareas, filters, sync.boardColumns],
  );
  const taskStats = useMemo(
    () => computeTaskStats(sync.tareas, sync.boardColumns),
    [sync.tareas, sync.boardColumns],
  );
  const activeFilterCount = useMemo(() => countActiveFilters(filters), [filters]);
  const filtersHideAll =
    Boolean(sync.activeProyecto) &&
    sync.tareas.length > 0 &&
    filteredTareas.length === 0 &&
    activeFilterCount > 0;

  const openTaskForm = useCallback(
    (opts?: { dueDate?: string; startDate?: string; status?: string }) => {
      setEditingTarea(null);
      // Gantt day-click: same day for start + due so the bar has a real planned range.
      const due = opts?.dueDate ?? null;
      const start = opts?.startDate ?? due;
      setCreateStartDate(start);
      setCreateDueDate(due);
      setCreateStatus(opts?.status ?? null);
      setTaskFormOpen(true);
    },
    [],
  );

  const openEditTask = useCallback((tarea: Tarea) => {
    setEditingTarea(tarea);
    setCreateStartDate(null);
    setCreateDueDate(null);
    setCreateStatus(null);
    setTaskFormOpen(true);
  }, []);

  const closeTaskForm = useCallback(() => {
    setTaskFormOpen(false);
    setEditingTarea(null);
    setCreateStartDate(null);
    setCreateDueDate(null);
    setCreateStatus(null);
  }, []);

  const handleTaskSubmit = useCallback(
    async (input: TareaInput) => {
      if (editingTarea) {
        await sync.patchTarea(editingTarea.id, input);
        addToast({ message: 'Tarea actualizada', type: 'success' });
      } else {
        await sync.addTarea(input);
        addToast({ message: 'Tarea creada', type: 'success' });
      }
    },
    [editingTarea, sync, addToast],
  );

  const handleCompleteTask = useCallback(
    (tarea: Tarea) => {
      const doneKey =
        sync.boardColumns.find((c) => c.is_done && c.key !== 'closed')?.key ??
        sync.boardColumns.find((c) => c.is_done)?.key ??
        'done';
      const openKey =
        sync.boardColumns.find((c) => !c.is_done && c.key === 'todo')?.key ??
        sync.boardColumns.find((c) => !c.is_done)?.key ??
        'todo';
      const isDone = sync.boardColumns.find((c) => c.key === tarea.status)?.is_done
        ?? (tarea.status === 'done' || tarea.status === 'closed');
      const nextStatus = isDone ? openKey : doneKey;
      void sync.patchTarea(tarea.id, { status: nextStatus }).catch((err) => {
        addToast({
          message: err instanceof Error ? err.message : 'No se pudo actualizar la tarea',
          type: 'error',
        });
      });
    },
    [sync, addToast],
  );

  const handleAddBoardColumn = useCallback(
    async (name: string) => {
      try {
        await sync.addBoardColumn({ name });
        addToast({ message: 'Columna creada', type: 'success' });
      } catch (err) {
        addToast({
          message: err instanceof Error ? err.message : 'Error al crear columna',
          type: 'error',
        });
        throw err;
      }
    },
    [sync, addToast],
  );

  const handleRenameBoardColumn = useCallback(
    async (id: string, name: string) => {
      try {
        await sync.patchBoardColumn(id, { name });
        addToast({ message: 'Columna renombrada', type: 'success' });
      } catch (err) {
        addToast({
          message: err instanceof Error ? err.message : 'Error al renombrar columna',
          type: 'error',
        });
        throw err;
      }
    },
    [sync, addToast],
  );

  const handleDeleteBoardColumn = useCallback(
    async (id: string) => {
      const col = sync.boardColumns.find((c) => c.id === id);
      if (!col) return;
      const ok = await confirm({
        title: 'Eliminar columna',
        description: `¿Eliminar «${col.name}»? La columna debe estar vacía. Esta acción no se puede deshacer.`,
        confirmLabel: 'Eliminar',
        cancelLabel: 'Cancelar',
        type: 'destructive',
      });
      if (!ok) return;
      try {
        await sync.removeBoardColumn(id);
        addToast({ message: 'Columna eliminada', type: 'success' });
      } catch (err) {
        addToast({
          message: err instanceof Error ? err.message : 'Error al eliminar columna',
          type: 'error',
        });
        throw err;
      }
    },
    [sync, confirm, addToast],
  );

  const scheduleDeleteWithUndo = useCallback(
    (snapshots: Tarea[]) => {
      if (snapshots.length === 0) return;

      for (const tarea of snapshots) {
        const existing = pendingDeletesRef.current.get(tarea.id);
        if (existing) clearTimeout(existing.timer);
        sync.softRemoveTarea(tarea.id);
        setSelectedIds((prev) => {
          if (!prev.has(tarea.id)) return prev;
          const next = new Set(prev);
          next.delete(tarea.id);
          return next;
        });

        const timer = setTimeout(() => {
          pendingDeletesRef.current.delete(tarea.id);
          void sync.commitDeleteTarea(tarea.id).catch((err) => {
            sync.restoreTarea(tarea);
            addToast({
              message: err instanceof Error ? err.message : 'No se pudo eliminar la tarea',
              type: 'error',
            });
          });
        }, 6000);
        pendingDeletesRef.current.set(tarea.id, { tarea, timer });
      }

      const label =
        snapshots.length === 1
          ? `«${snapshots[0].title}» eliminada`
          : `${snapshots.length} tareas eliminadas`;

      addToast({
        message: label,
        type: 'success',
        duration: 6000,
        action: {
          label: 'Deshacer',
          onClick: () => {
            for (const tarea of snapshots) {
              const entry = pendingDeletesRef.current.get(tarea.id);
              if (entry) {
                clearTimeout(entry.timer);
                pendingDeletesRef.current.delete(tarea.id);
              }
              sync.restoreTarea(tarea);
            }
          },
        },
      });
    },
    [sync, addToast],
  );

  const handleDeleteTask = useCallback(
    async (tarea: Tarea) => {
      const ok = await confirm({
        title: 'Eliminar tarea',
        description: `¿Eliminar «${tarea.title}»? Podrás deshacerlo unos segundos.`,
        confirmLabel: 'Eliminar',
        cancelLabel: 'Cancelar',
        type: 'destructive',
      });
      if (!ok) return;
      scheduleDeleteWithUndo([tarea]);
    },
    [confirm, scheduleDeleteWithUndo],
  );

  const handleToggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleToggleSelectAll = useCallback(() => {
    setSelectedIds((prev) => {
      const visible = filteredTareas;
      if (visible.length === 0) return prev;
      const allOn = visible.every((t) => prev.has(t.id));
      if (allOn) return new Set();
      return new Set(visible.map((t) => t.id));
    });
  }, [filteredTareas]);

  const handleBulkStatus = useCallback(
    (status: TareaStatus) => {
      const ids = [...selectedIds];
      if (ids.length === 0) return;
      for (const id of ids) {
        void sync.patchTarea(id, { status }).catch((err) => {
          addToast({
            message: err instanceof Error ? err.message : 'No se pudo actualizar el estado',
            type: 'error',
          });
        });
      }
      setSelectedIds(new Set());
      addToast({
        message:
          ids.length === 1
            ? 'Estado actualizado'
            : `Estado actualizado en ${ids.length} tareas`,
        type: 'success',
      });
    },
    [selectedIds, sync, addToast],
  );

  const handleBulkDelete = useCallback(async () => {
    const snapshots = sync.tareas.filter((t) => selectedIds.has(t.id));
    if (snapshots.length === 0) return;
    const ok = await confirm({
      title: 'Eliminar tareas',
      description: `¿Eliminar ${snapshots.length} tarea${snapshots.length === 1 ? '' : 's'}? Podrás deshacerlo unos segundos.`,
      confirmLabel: 'Eliminar',
      cancelLabel: 'Cancelar',
      type: 'destructive',
    });
    if (!ok) return;
    scheduleDeleteWithUndo(snapshots);
  }, [sync.tareas, selectedIds, confirm, scheduleDeleteWithUndo]);

  // Local shortcuts when not typing in a field: N nueva, / buscar, 1–5 vistas.
  useEffect(() => {
    const views: VistaType[] = ['list', 'board', 'table', 'calendar', 'gantt'];
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const tag = target.tagName;
      const typing =
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        target.isContentEditable;
      if (typing) return;
      if (taskFormOpen || createModal) return;
      if (!sync.activeProyecto) return;

      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        openTaskForm();
        return;
      }
      if (e.key === '/') {
        e.preventDefault();
        document.querySelector<HTMLInputElement>('input[aria-label="Buscar tareas"]')?.focus();
        return;
      }
      if (e.key >= '1' && e.key <= '5') {
        e.preventDefault();
        handleViewChange(views[Number(e.key) - 1]);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [sync.activeProyecto, taskFormOpen, createModal, openTaskForm, handleViewChange]);

  const handleCreate = useCallback(
    async (name: string) => {
      try {
        if (createModal === 'espacio') {
          await sync.addEspacio(name);
          addToast({ message: 'Espacio creado', type: 'success' });
        } else if (createModal === 'proyecto') {
          await sync.addProyecto(name);
          addToast({ message: 'Proyecto creado', type: 'success' });
        }
      } catch (err) {
        addToast({
          message: err instanceof Error ? err.message : 'Error al crear',
          type: 'error',
        });
        throw err;
      }
    },
    [createModal, sync, addToast],
  );

  const handleDeleteEspacio = useCallback(
    async (id: string) => {
      const espacio = sync.espacios.find((e) => e.id === id);
      if (!espacio) return;

      const ok = await confirm({
        title: 'Eliminar espacio',
        description: `¿Eliminar el espacio «${espacio.name}»? Se eliminarán todos sus proyectos y tareas. Esta acción no se puede deshacer.`,
        confirmLabel: 'Eliminar',
        cancelLabel: 'Cancelar',
        type: 'destructive',
      });
      if (!ok) return;

      try {
        await sync.removeEspacio(id);
        addToast({ message: 'Espacio eliminado', type: 'success' });
      } catch (err) {
        addToast({
          message: err instanceof Error ? err.message : 'Error al eliminar espacio',
          type: 'error',
        });
      }
    },
    [sync, confirm, addToast],
  );

  const handleDeleteProyecto = useCallback(
    async (id: string) => {
      const proyecto = sync.proyectos.find((p) => p.id === id);
      if (!proyecto) return;

      const ok = await confirm({
        title: 'Eliminar proyecto',
        description: `¿Eliminar el proyecto «${proyecto.name}»? Se eliminarán todas sus tareas. Esta acción no se puede deshacer.`,
        confirmLabel: 'Eliminar',
        cancelLabel: 'Cancelar',
        type: 'destructive',
      });
      if (!ok) return;

      try {
        await sync.removeProyecto(id);
        addToast({ message: 'Proyecto eliminado', type: 'success' });
      } catch (err) {
        addToast({
          message: err instanceof Error ? err.message : 'Error al eliminar proyecto',
          type: 'error',
        });
      }
    },
    [sync, confirm, addToast],
  );

  const handleToggleFavorite = useCallback(async () => {
    if (!sync.activeProyecto) return;
    try {
      await sync.patchProyecto(sync.activeProyecto.id, { is_favorite: !sync.activeProyecto.is_favorite });
    } catch (err) {
      addToast({ message: err instanceof Error ? err.message : 'Error al actualizar', type: 'error' });
    }
  }, [sync, addToast]);

  const handleEspacioColorChange = useCallback(
    async (id: string, color: string) => {
      try {
        await sync.patchEspacio(id, { color });
      } catch (err) {
        addToast({ message: err instanceof Error ? err.message : 'Error al actualizar color', type: 'error' });
      }
    },
    [sync, addToast],
  );

  const handleProyectoColorChange = useCallback(
    async (id: string, color: string) => {
      try {
        await sync.patchProyecto(id, { color });
      } catch (err) {
        addToast({ message: err instanceof Error ? err.message : 'Error al actualizar color', type: 'error' });
      }
    },
    [sync, addToast],
  );

  const handleRenameEspacio = useCallback(
    async (id: string, name: string) => {
      try {
        await sync.patchEspacio(id, { name });
        addToast({ message: 'Espacio renombrado', type: 'success' });
      } catch (err) {
        addToast({ message: err instanceof Error ? err.message : 'Error al renombrar espacio', type: 'error' });
      }
    },
    [sync, addToast],
  );

  const handleRenameProyecto = useCallback(
    async (id: string, name: string) => {
      try {
        await sync.patchProyecto(id, { name });
        addToast({ message: 'Proyecto renombrado', type: 'success' });
      } catch (err) {
        addToast({ message: err instanceof Error ? err.message : 'Error al renombrar proyecto', type: 'error' });
      }
    },
    [sync, addToast],
  );

  const handleSidebarPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    resizeStartXRef.current = e.clientX;
    resizeStartWidthRef.current = sidebarWidthRef.current;
    setIsResizingSidebar(true);
  }, []);

  const handleSidebarPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const next = clampSidebarWidth(resizeStartWidthRef.current + (e.clientX - resizeStartXRef.current));
    sidebarWidthRef.current = next;
    setSidebarWidth(next);
  }, []);

  const handleSidebarPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    setIsResizingSidebar(false);
    writeStoredSidebarWidth(sidebarWidthRef.current);
  }, []);

  const handleSidebarResizeReset = useCallback(() => {
    sidebarWidthRef.current = ESPACIOS_SIDEBAR_DEFAULT_WIDTH;
    setSidebarWidth(ESPACIOS_SIDEBAR_DEFAULT_WIDTH);
    writeStoredSidebarWidth(ESPACIOS_SIDEBAR_DEFAULT_WIDTH);
  }, []);

  if (sync.loading) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <Loader2 className="h-6 w-6 animate-spin text-[var(--accent-primary)]" />
        <p className="text-sm text-[var(--text-muted)]">Cargando espacios...</p>
      </div>
    );
  }

  if (sync.error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-sm text-[var(--accent-red)]">{sync.error}</p>
        <p className="max-w-md text-xs leading-relaxed text-[var(--text-muted)]">
          Verifica la conexión a Supabase y que las migraciones{' '}
          <code className="text-[var(--text-secondary)]">0003_espacios</code>
          {', '}
          <code className="text-[var(--text-secondary)]">0005_espacios_active_user_fix</code>
          {' '}y{' '}
          <code className="text-[var(--text-secondary)]">0007_board_columns</code>
          {' '}estén aplicadas (<code className="text-[var(--text-secondary)]">pwsh scripts/supabase-db-push.ps1</code>).
        </p>
        <button
          type="button"
          onClick={() => void sync.reloadAll()}
          className="inline-flex items-center gap-2 rounded-full bg-[var(--accent-primary)] px-4 py-2 text-sm text-[var(--text-on-accent)] transition-colors hover:bg-[var(--accent-primary-hover)]"
        >
          <RefreshCw className="h-4 w-4" />
          Reintentar
        </button>
      </div>
    );
  }

  const hasEspacios = sync.espacios.length > 0;

  return (
    // overflow-hidden + min-h-0 on every flex level so the main pane keeps a
    // real height inside App's full-bleed shell (otherwise Welcome/views collapse).
    // Left column (header + nav) shares one width so the vertical edge never splits.
    <div className="flex h-full min-h-0 overflow-hidden bg-[var(--bg-base)]">
      <div
        className="relative flex h-full min-h-0 shrink-0 flex-col border-r border-[var(--border-subtle)] bg-[var(--bg-elevated)]"
        style={{ width: sidebarWidth }}
      >
        <div className="flex h-11 shrink-0 items-center justify-between border-b border-[var(--border-subtle)] px-3">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
            Espacios
          </span>
          <button
            type="button"
            onClick={() => setCreateModal('espacio')}
            className="rounded-md p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-base)] hover:text-[var(--text-primary)]"
            aria-label="Nuevo espacio"
            title="Nuevo espacio"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
        <SpaceSidebar
          espacios={sync.espacios}
          proyectos={sync.proyectos}
          activeEspacioId={sync.activeEspacioId}
          activeProyectoId={sync.activeProyectoId}
          onSelectEspacio={sync.setActiveEspacioId}
          onSelectProyecto={sync.setActiveProyectoId}
          onAddEspacio={() => setCreateModal('espacio')}
          onAddProyecto={() => setCreateModal('proyecto')}
          onDeleteEspacio={(id) => void handleDeleteEspacio(id)}
          onDeleteProyecto={(id) => void handleDeleteProyecto(id)}
          onRenameEspacio={(id, name) => void handleRenameEspacio(id, name)}
          onRenameProyecto={(id, name) => void handleRenameProyecto(id, name)}
          onEspacioColorChange={(id, color) => void handleEspacioColorChange(id, color)}
          onProyectoColorChange={(id, color) => void handleProyectoColorChange(id, color)}
        />

        {/* Hit target over the right border (no extra layout gap). Pointer capture = reliable drag. */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-valuenow={sidebarWidth}
          aria-valuemin={ESPACIOS_SIDEBAR_MIN_WIDTH}
          aria-valuemax={ESPACIOS_SIDEBAR_MAX_WIDTH}
          aria-label="Cambiar tamaño del panel lateral"
          title="Arrastrar para cambiar tamaño · Doble clic para restablecer"
          className={`absolute inset-y-0 -right-1 z-30 w-3 cursor-col-resize touch-none select-none ${
            isResizingSidebar ? 'bg-[var(--accent-primary)]/25' : 'bg-transparent hover:bg-[var(--accent-primary)]/15'
          }`}
          onPointerDown={handleSidebarPointerDown}
          onPointerMove={handleSidebarPointerMove}
          onPointerUp={handleSidebarPointerUp}
          onPointerCancel={handleSidebarPointerUp}
          onDoubleClick={(e) => {
            e.preventDefault();
            handleSidebarResizeReset();
          }}
        />
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex h-11 shrink-0 items-center border-b border-[var(--border-subtle)] px-6">
          {hasEspacios && !sync.activeProyecto && (
            <p className="text-sm text-[var(--text-muted)]">
              Selecciona un espacio y un proyecto para gestionar tareas.
            </p>
          )}
          {sync.activeEspacio && sync.activeProyecto && (
            <nav className="flex min-w-0 items-center gap-1 text-xs text-[var(--text-muted)]" aria-label="Ruta">
              <span className="truncate">{sync.activeEspacio.name}</span>
              <ChevronRight className="h-3 w-3 shrink-0" />
              <span>Proyectos</span>
              <ChevronRight className="h-3 w-3 shrink-0" />
              <span className="truncate text-[var(--text-secondary)]">{sync.activeProyecto.name}</span>
            </nav>
          )}
        </div>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {!hasEspacios ? (
            <EspaciosWelcome onCreateEspacio={() => setCreateModal('espacio')} />
          ) : (
            <>
              <ProjectHeader
                proyecto={sync.activeProyecto}
                stats={sync.activeProyecto ? taskStats : null}
                filteredCount={filteredTareas.length}
                totalCount={sync.tareas.length}
                realtimeStatus={sync.realtimeStatus}
                onToggleFavorite={() => void handleToggleFavorite()}
              />

              {sync.activeProyecto && (
                <>
                  <ViewTabs active={activeView} onChange={handleViewChange} />
                  <FilterBar
                    filters={filters}
                    members={members}
                    columns={sync.boardColumns}
                    resultCount={filteredTareas.length}
                    onChange={(patch) => setFilters((f) => ({ ...f, ...patch }))}
                    onClear={() => setFilters(DEFAULT_FILTERS)}
                    onAddTask={() => openTaskForm()}
                  />
                  {(activeView === 'list' || activeView === 'table') && selectedIds.size > 0 && (
                    <BulkActionBar
                      count={selectedIds.size}
                      columns={sync.boardColumns}
                      onClear={() => setSelectedIds(new Set())}
                      onBulkStatus={handleBulkStatus}
                      onBulkDelete={() => void handleBulkDelete()}
                    />
                  )}
                </>
              )}

              <div
                className={`min-h-0 flex-1 ${
                  activeView === 'board' || activeView === 'calendar' || activeView === 'gantt'
                    ? 'flex flex-col overflow-hidden'
                    : 'overflow-y-auto py-2'
                }`}
              >
                {!sync.activeProyecto ? (
                  <EmptyState
                    icon={FolderKanban}
                    title="Crea tu primer proyecto"
                    description="Dentro de cada espacio puedes tener varios proyectos. Selecciona un espacio en la barra lateral y crea uno para gestionar tareas."
                    actionLabel={sync.activeEspacioId ? 'Nuevo proyecto' : undefined}
                    onAction={sync.activeEspacioId ? () => setCreateModal('proyecto') : undefined}
                  />
                ) : filtersHideAll ? (
                  <EmptyState
                    icon={SearchX}
                    title="Ninguna tarea coincide"
                    description="Prueba a cambiar la búsqueda, el estado o el asignado. También puedes incluir completadas."
                    actionLabel="Limpiar filtros"
                    onAction={() => setFilters(DEFAULT_FILTERS)}
                  />
                ) : activeView === 'list' ? (
                  <ListView
                    tareas={filteredTareas}
                    members={members}
                    columns={sync.boardColumns}
                    onStatusChange={(id, status) => {
                      void sync.patchTarea(id, { status }).catch((err) => {
                        addToast({
                          message: err instanceof Error ? err.message : 'No se pudo actualizar el estado',
                          type: 'error',
                        });
                      });
                    }}
                    onEdit={openEditTask}
                    onDelete={(id) => {
                      const tarea = sync.tareas.find((t) => t.id === id);
                      if (tarea) void handleDeleteTask(tarea);
                    }}
                    onAddTask={() => openTaskForm()}
                  />
                ) : activeView === 'board' ? (
                  <BoardView
                    tareas={filteredTareas}
                    members={members}
                    columns={sync.boardColumns}
                    showClosed={filters.showClosed}
                    projectName={sync.activeProyecto?.name}
                    onStatusChange={(id, status, sortOrder) => {
                      void sync.patchTarea(id, { status, sort_order: sortOrder }).catch((err) => {
                        addToast({
                          message: err instanceof Error ? err.message : 'No se pudo mover la tarea',
                          type: 'error',
                        });
                      });
                    }}
                    onEditTask={openEditTask}
                    onCompleteTask={handleCompleteTask}
                    onDeleteTask={(tarea) => void handleDeleteTask(tarea)}
                    onAddTask={(status) => openTaskForm({ status })}
                    onAddColumn={handleAddBoardColumn}
                    onRenameColumn={handleRenameBoardColumn}
                    onDeleteColumn={handleDeleteBoardColumn}
                  />
                ) : activeView === 'table' ? (
                  <TableView
                    tareas={filteredTareas}
                    members={members}
                    columns={sync.boardColumns}
                    onStatusChange={(id, status) => {
                      void sync.patchTarea(id, { status }).catch((err) => {
                        addToast({
                          message: err instanceof Error ? err.message : 'No se pudo actualizar el estado',
                          type: 'error',
                        });
                      });
                    }}
                    onComplete={handleCompleteTask}
                    onEdit={openEditTask}
                    onDelete={(id) => {
                      const tarea = sync.tareas.find((t) => t.id === id);
                      if (tarea) void handleDeleteTask(tarea);
                    }}
                    onAddTask={() => openTaskForm()}
                  />
                ) : activeView === 'calendar' ? (
                  <CalendarView
                    tareas={filteredTareas}
                    columns={sync.boardColumns}
                    onDateChange={(id, dueDate) => {
                      void sync.patchTarea(id, { due_date: dueDate }).catch((err) => {
                        addToast({
                          message: err instanceof Error ? err.message : 'No se pudo actualizar la fecha',
                          type: 'error',
                        });
                      });
                    }}
                    onDatesChange={(id, startDate, dueDate) => {
                      void sync.patchTarea(id, { start_date: startDate, due_date: dueDate }).catch((err) => {
                        addToast({
                          message: err instanceof Error ? err.message : 'No se pudo actualizar la fecha',
                          type: 'error',
                        });
                      });
                    }}
                    onAddTask={() => openTaskForm()}
                    onAddTaskOnDate={(dueDate) => openTaskForm({ dueDate })}
                    onEditTask={openEditTask}
                  />
                ) : (
                  <GanttView
                    tareas={filteredTareas}
                    columns={sync.boardColumns}
                    onDatesChange={(id, startDate, dueDate) => {
                      void sync.patchTarea(id, { start_date: startDate, due_date: dueDate }).catch((err) => {
                        addToast({
                          message: err instanceof Error ? err.message : 'No se pudo actualizar la fecha',
                          type: 'error',
                        });
                      });
                    }}
                    onAddTask={() => openTaskForm()}
                    onAddTaskOnDate={(dueDate) => openTaskForm({ dueDate })}
                    onEditTask={openEditTask}
                  />
                )}
              </div>
            </>
          )}
        </div>
      </div>

      <TaskForm
        open={taskFormOpen}
        members={members}
        columns={sync.boardColumns}
        initial={editingTarea}
        defaultStartDate={createStartDate}
        defaultDueDate={createDueDate}
        defaultStatus={createStatus}
        onClose={closeTaskForm}
        onSubmit={handleTaskSubmit}
      />

      {createModal && (
        <CreateNameModal
          open
          variant={createModal}
          onClose={() => setCreateModal(null)}
          onSubmit={handleCreate}
        />
      )}
    </div>
  );
}