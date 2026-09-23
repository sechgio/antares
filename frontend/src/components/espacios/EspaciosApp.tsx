import { WithHoverTooltip } from '@/components/ui/HoverTooltip';
import { ChevronRight, FolderKanban, Loader2, Plus, RefreshCw, SearchX } from 'lucide-react';
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { isEditableKeyboardTarget } from '../../utils/dom';
import { useDialog } from '../../hooks/useDialog';
import { useToast } from '../../hooks/useToast';
import { useToastAction } from '../../hooks/useToastAction';
import BulkActionBar from './components/BulkActionBar';
import CreateNameModal from './components/CreateNameModal';
import EmptyState from './components/EmptyState';
import EspaciosWelcome from './components/EspaciosWelcome';
import FilterBar from './components/filters/FilterBar';
import MyTasksView from './components/MyTasksView';
import ProjectHeader from './components/ProjectHeader';
import SpaceSidebar from './components/SpaceSidebar';
import TareasLoadingSkeleton from './components/TareasLoadingSkeleton';
import TaskForm from './components/TaskForm';
import ViewTabs from './components/ViewTabs';
import BoardView from './components/views/BoardView';
import GanttView from './components/views/GanttView';
import ListView from './components/views/ListView';
import TableView from './components/views/TableView';

const CalendarView = lazy(() => import('./components/views/CalendarView'));
import { useEspaciosSync } from './hooks/useEspaciosSync';
import { useMyTasks } from './hooks/useMyTasks';
import { useTeamMembers } from './hooks/useTeamMembers';
import {
  DEFAULT_FILTERS,
  DEFAULT_MY_TASKS_FILTERS,
  type MyTask,
  type MyTasksFilters,
  type Tarea,
  type TareaFilters,
  type TareaInput,
  type TareaStatus,
  type VistaType,
} from './types';
import { fetchBoardColumns } from './api/espaciosApi';
import { computeTaskStats, countActiveFilters, filterTareas } from './utils/filters';
import {
  consumeEspaciosFocusTarget,
  ESPACIOS_FOCUS_EVENT,
} from './utils/focusTarget';
import { readEspaciosPrefs, writeEspaciosPrefs } from './utils/sessionPrefs';
import { fallbackBoardColumns } from './utils/statusConfig';
import {
  clampSidebarWidth,
  ESPACIOS_SIDEBAR_DEFAULT_WIDTH,
  ESPACIOS_SIDEBAR_MAX_WIDTH,
  ESPACIOS_SIDEBAR_MIN_WIDTH,
  readStoredSidebarWidth,
  writeStoredSidebarWidth,
} from './utils/sidebarWidth';
import Button from '@/components/ui/Button';
import { errorMessage } from '@/utils/errors';

type CreateModal = 'espacio' | 'proyecto' | null;

export default function EspaciosApp() {
  const { user } = useAuth();
  const { confirm } = useDialog();
  const { addToast } = useToast();
  const toastAction = useToastAction();
  const sync = useEspaciosSync(user?.id);
  const { members, error: membersError } = useTeamMembers();
  const [activeView, setActiveView] = useState<VistaType>(() => readEspaciosPrefs().activeView);
  const [filters, setFilters] = useState<TareaFilters>(DEFAULT_FILTERS);
  const [myTasksFilters, setMyTasksFilters] = useState<MyTasksFilters>(DEFAULT_MY_TASKS_FILTERS);
  const [showMyTasks, setShowMyTasks] = useState(false);
  const myTasks = useMyTasks(showMyTasks ? user?.id : undefined, myTasksFilters);
  const [taskFormOpen, setTaskFormOpen] = useState(false);
  const [editingTarea, setEditingTarea] = useState<Tarea | null>(null);
  const [editingColumns, setEditingColumns] = useState<typeof sync.boardColumns | null>(null);
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
  const editingTareaIdRef = useRef<string | null>(null);
  type PendingDelete = {
    tarea: Tarea;
    timer: ReturnType<typeof setTimeout>;
    cancelled: boolean;
    committing: boolean;
  };
  const pendingDeletesRef = useRef<Map<string, PendingDelete>>(new Map());
  sidebarWidthRef.current = sidebarWidth;

  const { setActiveEspacioId, setActiveProyectoId, proyectos, tareas } = sync;

  const handleViewChange = useCallback((view: VistaType) => {
    setActiveView(view);
    writeEspaciosPrefs({ activeView: view });
    setSelectedIds(new Set());
  }, []);

  useEffect(() => {
    setSelectedIds(new Set());
  }, [sync.activeProyectoId]);

  const commitDeleteRef = useRef(sync.commitDeleteTarea);
  commitDeleteRef.current = sync.commitDeleteTarea;
  const addToastRef = useRef(addToast);
  addToastRef.current = addToast;

  useEffect(() => {
    const pending = pendingDeletesRef.current;
    return () => {
      for (const entry of pending.values()) {
        clearTimeout(entry.timer);
        entry.cancelled = true;
        void commitDeleteRef.current(entry.tarea.id).catch((err) => {
          const message = errorMessage(err, 'No se pudo eliminar la tarea');
          queueMicrotask(() => addToastRef.current({ message, type: 'error' }));
        });
      }
      pending.clear();
    };
  }, []);

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
      editingTareaIdRef.current = null;
      setEditingColumns(null);
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
    editingTareaIdRef.current = tarea.id;
    setEditingColumns(null);
    setCreateStartDate(null);
    setCreateDueDate(null);
    setCreateStatus(null);
    setTaskFormOpen(true);
  }, []);

  const openMyTask = useCallback((tarea: MyTask) => {
    setEditingTarea(tarea);
    editingTareaIdRef.current = tarea.id;
    setEditingColumns(fallbackBoardColumns(tarea.proyecto_id));
    setCreateStartDate(null);
    setCreateDueDate(null);
    setCreateStatus(null);
    setTaskFormOpen(true);
    void toastAction(
      () =>
        fetchBoardColumns(tarea.proyecto_id).then((columns) => {
          if (editingTareaIdRef.current === tarea.id) setEditingColumns(columns);
        }),
      { error: 'No se pudieron cargar los estados de la tarea', rethrow: false },
    );
  }, [toastAction]);

  const closeTaskForm = useCallback(() => {
    setTaskFormOpen(false);
    editingTareaIdRef.current = null;
    setEditingTarea(null);
    setEditingColumns(null);
    setCreateStartDate(null);
    setCreateDueDate(null);
    setCreateStatus(null);
  }, []);

  const handleTaskSubmit = useCallback(
    async (input: TareaInput) => {
      if (editingTarea) {
        await sync.patchTarea(editingTarea.id, input);
        if (showMyTasks) await myTasks.reload();
        addToast({ message: 'Tarea actualizada', type: 'success' });
      } else {
        await sync.addTarea(input);
        addToast({ message: 'Tarea creada', type: 'success' });
      }
    },
    [editingTarea, sync, showMyTasks, myTasks.reload, addToast],
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
      void toastAction(() => sync.patchTarea(tarea.id, { status: nextStatus }), {
        error: 'No se pudo actualizar la tarea',
        rethrow: false,
      });
    },
    [sync, toastAction],
  );

  const handleAddBoardColumn = useCallback(
    async (name: string) => {
      await toastAction(() => sync.addBoardColumn({ name }), {
        success: 'Columna creada',
        error: 'Error al crear columna',
      });
    },
    [sync, toastAction],
  );

  const handleRenameBoardColumn = useCallback(
    async (id: string, name: string) => {
      await toastAction(() => sync.patchBoardColumn(id, { name }), {
        success: 'Columna renombrada',
        error: 'Error al renombrar columna',
      });
    },
    [sync, toastAction],
  );

  const patchTareaToast = useCallback(
    (
      id: string,
      patch: Partial<TareaInput & Pick<Tarea, 'status'>>,
      error: string,
    ) =>
      void toastAction(() => sync.patchTarea(id, patch), {
        error,
        rethrow: false,
      }),
    [sync, toastAction],
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
      await toastAction(() => sync.removeBoardColumn(id), {
        success: 'Columna eliminada',
        error: 'Error al eliminar columna',
      });
    },
    [sync, confirm, toastAction],
  );

  const scheduleDeleteWithUndo = useCallback(
    (snapshots: Tarea[]) => {
      if (snapshots.length === 0) return;

      for (const tarea of snapshots) {
        const existing = pendingDeletesRef.current.get(tarea.id);
        if (existing) {
          clearTimeout(existing.timer);
          existing.cancelled = true;
        }
        sync.softRemoveTarea(tarea.id);
        setSelectedIds((prev) => {
          if (!prev.has(tarea.id)) return prev;
          const next = new Set(prev);
          next.delete(tarea.id);
          return next;
        });

        const entry: PendingDelete = {
          tarea,
          cancelled: false,
          committing: false,
          timer: setTimeout(() => {
          const current = pendingDeletesRef.current.get(tarea.id);
          if (!current || current.cancelled) {
            pendingDeletesRef.current.delete(tarea.id);
            return;
          }
          current.committing = true;
          void sync.commitDeleteTarea(tarea.id)
            .then(() => {
              const still = pendingDeletesRef.current.get(tarea.id);
              pendingDeletesRef.current.delete(tarea.id);
              if (still?.cancelled) {
                sync.softRemoveTarea(tarea.id);
                void sync.addTarea({
                  title: tarea.title,
                  description: tarea.description,
                  status: tarea.status,
                  priority: tarea.priority,
                  assignee_id: tarea.assignee_id,
                  start_date: tarea.start_date,
                  due_date: tarea.due_date,
                  sort_order: tarea.sort_order,
                }, tarea.proyecto_id).catch((err) => {
                  addToastRef.current({
                    message: errorMessage(err, 'No se pudo restaurar la tarea'),
                    type: 'error',
                  });
                });
              }
            })
            .catch((err) => {
              const still = pendingDeletesRef.current.get(tarea.id);
              pendingDeletesRef.current.delete(tarea.id);
              if (!still || still.cancelled) return;
              sync.restoreTarea(tarea);
              addToast({
                message: errorMessage(err, 'No se pudo eliminar la tarea'),
                type: 'error',
              });
            });
        }, 6000),
        };
        pendingDeletesRef.current.set(tarea.id, entry);
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
                entry.cancelled = true;
                if (!entry.committing) {
                  pendingDeletesRef.current.delete(tarea.id);
                }
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
        void toastAction(() => sync.patchTarea(id, { status }), {
          error: 'No se pudo actualizar el estado',
          rethrow: false,
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

  useEffect(() => {
    const views: VistaType[] = ['list', 'board', 'table', 'calendar', 'gantt'];
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (!target || isEditableKeyboardTarget(target)) return;
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
      await toastAction(
        async () => {
          if (createModal === 'espacio') await sync.addEspacio(name);
          else if (createModal === 'proyecto') await sync.addProyecto(name);
        },
        {
          success:
            createModal === 'espacio'
              ? 'Espacio creado'
              : createModal === 'proyecto'
                ? 'Proyecto creado'
                : undefined,
          error: 'Error al crear',
        },
      );
    },
    [createModal, sync, toastAction],
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

      await toastAction(() => sync.removeEspacio(id), {
        success: 'Espacio eliminado',
        error: 'Error al eliminar espacio',
        rethrow: false,
      });
    },
    [sync, confirm, toastAction],
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

      await toastAction(() => sync.removeProyecto(id), {
        success: 'Proyecto eliminado',
        error: 'Error al eliminar proyecto',
        rethrow: false,
      });
    },
    [sync, confirm, toastAction],
  );

  const handleToggleFavorite = useCallback(async () => {
    const proyecto = sync.activeProyecto;
    if (!proyecto) return;
    await toastAction(
      () => sync.patchProyecto(proyecto.id, { is_favorite: !proyecto.is_favorite }),
      { error: 'Error al actualizar', rethrow: false },
    );
  }, [sync, toastAction]);

  const handleEspacioColorChange = useCallback(
    async (id: string, color: string) => {
      await toastAction(() => sync.patchEspacio(id, { color }), {
        error: 'Error al actualizar color',
        rethrow: false,
      });
    },
    [sync, toastAction],
  );

  const handleProyectoColorChange = useCallback(
    async (id: string, color: string) => {
      await toastAction(() => sync.patchProyecto(id, { color }), {
        error: 'Error al actualizar color',
        rethrow: false,
      });
    },
    [sync, toastAction],
  );

  const handleRenameEspacio = useCallback(
    async (id: string, name: string) => {
      await toastAction(() => sync.patchEspacio(id, { name }), {
        success: 'Espacio renombrado',
        error: 'Error al renombrar espacio',
        rethrow: false,
      });
    },
    [sync, toastAction],
  );

  const handleRenameProyecto = useCallback(
    async (id: string, name: string) => {
      await toastAction(() => sync.patchProyecto(id, { name }), {
        success: 'Proyecto renombrado',
        error: 'Error al renombrar proyecto',
        rethrow: false,
      });
    },
    [sync, toastAction],
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
          {' '}estén aplicadas en Supabase.
        </p>
        <Button variant="none" size="none"
          onClick={() => void sync.reloadAll()}
          className="inline-flex items-center gap-2 rounded-full bg-[var(--accent-primary)] px-4 py-2 text-sm text-[var(--text-on-accent)] transition-colors hover:bg-[var(--accent-primary-hover)]"
        >
          <RefreshCw className="h-4 w-4" />
          Reintentar
        </Button>
      </div>
    );
  }

  const hasEspacios = sync.espacios.length > 0;

  return (
    <div className="flex h-full min-h-0 overflow-hidden bg-[var(--bg-base)]">
      <div
        className="relative flex h-full min-h-0 shrink-0 flex-col border-r border-[var(--border-subtle)] bg-[var(--bg-elevated)]"
        style={{ width: sidebarWidth }}
      >
        <div className="flex h-11 shrink-0 items-center justify-between border-b border-[var(--border-subtle)] px-3">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
            Espacios
          </span>
          <WithHoverTooltip label="Nuevo espacio" placement="right">
            <Button variant="none" size="none"
              onClick={() => setCreateModal('espacio')}
              className="rounded-md p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-base)] hover:text-[var(--text-primary)]"
              aria-label="Nuevo espacio"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </WithHoverTooltip>
        </div>
        <SpaceSidebar
          espacios={sync.espacios}
          proyectos={sync.proyectos}
          activeEspacioId={sync.activeEspacioId}
          activeProyectoId={sync.activeProyectoId}
          myTasksActive={showMyTasks}
          onSelectMyTasks={() => {
            setShowMyTasks(true);
            setSelectedIds(new Set());
          }}
          onSelectEspacio={(id) => {
            setShowMyTasks(false);
            sync.setActiveEspacioId(id);
          }}
          onSelectProyecto={(id) => {
            setShowMyTasks(false);
            sync.setActiveProyectoId(id);
          }}
          onAddEspacio={() => setCreateModal('espacio')}
          onAddProyecto={() => setCreateModal('proyecto')}
          onDeleteEspacio={(id) => void handleDeleteEspacio(id)}
          onDeleteProyecto={(id) => void handleDeleteProyecto(id)}
          onRenameEspacio={(id, name) => void handleRenameEspacio(id, name)}
          onRenameProyecto={(id, name) => void handleRenameProyecto(id, name)}
          onEspacioColorChange={(id, color) => void handleEspacioColorChange(id, color)}
          onProyectoColorChange={(id, color) => void handleProyectoColorChange(id, color)}
        />

        <WithHoverTooltip
          label="Arrastrar para cambiar tamaño · Doble clic para restablecer"
          placement="right"
          className="absolute inset-y-0 -right-1 z-30 w-3"
        >
          <div
            role="separator"
            aria-orientation="vertical"
            aria-valuenow={sidebarWidth}
            aria-valuemin={ESPACIOS_SIDEBAR_MIN_WIDTH}
            aria-valuemax={ESPACIOS_SIDEBAR_MAX_WIDTH}
            aria-label="Cambiar tamaño del panel lateral"
            className={`h-full w-full cursor-col-resize touch-none select-none ${
              isResizingSidebar ? 'bg-[color:color-mix(in_srgb,var(--accent-primary)_25%,transparent)]' : 'bg-transparent hover:bg-[color:color-mix(in_srgb,var(--accent-primary)_15%,transparent)]'
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
        </WithHoverTooltip>
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex h-11 shrink-0 items-center border-b border-[var(--border-subtle)] px-6">
          {showMyTasks ? (
            <span className="text-xs font-medium text-[var(--text-secondary)]">Mis tareas</span>
          ) : hasEspacios && !sync.activeProyecto ? (
            <p className="text-sm text-[var(--text-muted)]">
              Selecciona un espacio y un proyecto para gestionar tareas.
            </p>
          ) : null}
          {!showMyTasks && sync.activeEspacio && sync.activeProyecto && (
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
          {showMyTasks ? (
            <MyTasksView
              tasks={myTasks.tasks}
              origins={myTasks.origins}
              filters={myTasksFilters}
              loading={myTasks.loading}
              loadingMore={myTasks.loadingMore}
              error={myTasks.error}
              hasMore={myTasks.hasMore}
              hasAssignments={myTasks.hasAssignments}
              onFiltersChange={(patch) => setMyTasksFilters((current) => ({ ...current, ...patch }))}
              onRetry={() => void myTasks.reload()}
              onLoadMore={() => void myTasks.loadMore()}
              onOpenTask={openMyTask}
            />
          ) : !hasEspacios ? (
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
                ) : sync.tareasLoading && sync.tareas.length === 0 ? (
                  <TareasLoadingSkeleton view={activeView} />
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
                    selectedIds={selectedIds}
                    onToggleSelect={handleToggleSelect}
                    onToggleSelectAll={handleToggleSelectAll}
                    onStatusChange={(id, status) =>
                      patchTareaToast(id, { status }, 'No se pudo actualizar el estado')
                    }
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
                    onStatusChange={(id, status, sortOrder) =>
                      patchTareaToast(id, { status, sort_order: sortOrder }, 'No se pudo mover la tarea')
                    }
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
                    selectedIds={selectedIds}
                    onToggleSelect={handleToggleSelect}
                    onToggleSelectAll={handleToggleSelectAll}
                    onStatusChange={(id, status) =>
                      patchTareaToast(id, { status }, 'No se pudo actualizar el estado')
                    }
                    onComplete={handleCompleteTask}
                    onEdit={openEditTask}
                    onDelete={(id) => {
                      const tarea = sync.tareas.find((t) => t.id === id);
                      if (tarea) void handleDeleteTask(tarea);
                    }}
                    onAddTask={() => openTaskForm()}
                  />
                ) : activeView === 'calendar' ? (
                  <Suspense
                    fallback={
                      <div className="flex h-full flex-col items-center justify-center gap-3">
                        <Loader2 className="h-6 w-6 animate-spin text-[var(--accent-primary)]" />
                        <p className="text-sm text-[var(--text-muted)]">Cargando calendario...</p>
                      </div>
                    }
                  >
                    <CalendarView
                      tareas={filteredTareas}
                      columns={sync.boardColumns}
                      onDateChange={(id, dueDate) =>
                        patchTareaToast(id, { due_date: dueDate }, 'No se pudo actualizar la fecha')
                      }
                      onDatesChange={(id, startDate, dueDate) =>
                        patchTareaToast(
                          id,
                          { start_date: startDate, due_date: dueDate },
                          'No se pudo actualizar la fecha',
                        )
                      }
                      onAddTask={() => openTaskForm()}
                      onAddTaskOnDate={(dueDate) => openTaskForm({ dueDate })}
                      onEditTask={openEditTask}
                    />
                  </Suspense>
                ) : (
                  <GanttView
                    tareas={filteredTareas}
                    columns={sync.boardColumns}
                    onDatesChange={(id, startDate, dueDate) =>
                      patchTareaToast(
                        id,
                        { start_date: startDate, due_date: dueDate },
                        'No se pudo actualizar la fecha',
                      )
                    }
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
        columns={editingTarea ? (editingColumns ?? sync.boardColumns) : sync.boardColumns}
        initial={editingTarea}
        defaultStartDate={createStartDate}
        defaultDueDate={createDueDate}
        defaultStatus={createStatus}
        currentUserId={user?.id}
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
