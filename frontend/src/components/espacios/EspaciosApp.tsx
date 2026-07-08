import { ChevronRight, FolderKanban, Loader2, Plus, RefreshCw } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { useDialog } from '../../hooks/useDialog';
import { useToast } from '../../hooks/useToast';
import CreateNameModal from './components/CreateNameModal';
import EmptyState from './components/EmptyState';
import EspaciosWelcome from './components/EspaciosWelcome';
import FilterBar from './components/filters/FilterBar';
import ProjectHeader from './components/ProjectHeader';
import SpaceSidebar from './components/SpaceSidebar';
import StatsPanel from './components/StatsPanel';
import TaskForm from './components/TaskForm';
import ViewTabs from './components/ViewTabs';
import BoardView from './components/views/BoardView';
import CalendarView from './components/views/CalendarView';
import GanttView from './components/views/GanttView';
import ListView from './components/views/ListView';
import { useEspaciosSync } from './hooks/useEspaciosSync';
import { useTeamMembers } from './hooks/useTeamMembers';
import { DEFAULT_FILTERS, type TareaFilters, type VistaType } from './types';
import { computeTaskStats, filterTareas } from './utils/filters';

type CreateModal = 'espacio' | 'proyecto' | null;



export default function EspaciosApp() {
  const { user } = useAuth();
  const { confirm } = useDialog();
  const { addToast } = useToast();
  const sync = useEspaciosSync(user?.id);
  const { members } = useTeamMembers();
  const [activeView, setActiveView] = useState<VistaType>('list');
  const [filters, setFilters] = useState<TareaFilters>(DEFAULT_FILTERS);
  const [taskFormOpen, setTaskFormOpen] = useState(false);
  const [createModal, setCreateModal] = useState<CreateModal>(null);

  const filteredTareas = useMemo(() => filterTareas(sync.tareas, filters), [sync.tareas, filters]);
  const taskStats = useMemo(() => computeTaskStats(sync.tareas), [sync.tareas]);

  const openTaskForm = useCallback(() => setTaskFormOpen(true), []);

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
          Verifica la conexión a Supabase y que la migración <code className="text-[var(--text-secondary)]">0003_espacios</code> esté aplicada.
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
    <div className="flex h-full min-h-0 flex-col bg-[var(--bg-base)]">
      <div className="flex h-11 shrink-0 border-b border-[var(--border-subtle)]">
        <div className="flex w-60 shrink-0 items-center justify-between border-r border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3">
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
        <div className="flex min-w-0 flex-1 items-center px-6">
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
      </div>

      <div className="flex min-h-0 flex-1">
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
          onEspacioColorChange={(id, color) => void handleEspacioColorChange(id, color)}
          onProyectoColorChange={(id, color) => void handleProyectoColorChange(id, color)}
        />

        <div className="flex min-w-0 flex-1 flex-col">
          {!hasEspacios ? (
            <EspaciosWelcome onCreateEspacio={() => setCreateModal('espacio')} />
          ) : (
            <>
              <ProjectHeader
                proyecto={sync.activeProyecto}
                stats={sync.activeProyecto ? taskStats : null}
                onToggleFavorite={() => void handleToggleFavorite()}
              />

              {sync.activeProyecto && (
                <>
                  <ViewTabs active={activeView} onChange={setActiveView} />
                  <FilterBar
                    filters={filters}
                    members={members}
                    resultCount={filteredTareas.length}
                    onChange={(patch) => setFilters((f) => ({ ...f, ...patch }))}
                    onClear={() => setFilters(DEFAULT_FILTERS)}
                    onAddTask={openTaskForm}
                  />
                </>
              )}

              <div className="flex min-h-0 flex-1">
                <div className="min-h-0 flex-1 overflow-y-auto py-2">
                  {!sync.activeProyecto ? (
                    <EmptyState
                      icon={FolderKanban}
                      title="Crea tu primer proyecto"
                      description="Dentro de cada espacio puedes tener varios proyectos. Selecciona un espacio en la barra lateral y crea uno para gestionar tareas."
                      actionLabel={sync.activeEspacioId ? 'Nuevo proyecto' : undefined}
                      onAction={sync.activeEspacioId ? () => setCreateModal('proyecto') : undefined}
                    />
                  ) : activeView === 'list' ? (
                    <ListView
                      tareas={filteredTareas}
                      members={members}
                      onStatusChange={(id, status) => void sync.patchTarea(id, { status })}
                      onDelete={(id) => void sync.removeTarea(id)}
                      onAddTask={openTaskForm}
                    />
                  ) : activeView === 'board' ? (
                    <BoardView
                      tareas={filteredTareas}
                      members={members}
                      showClosed={filters.showClosed}
                      onStatusChange={(id, status, sortOrder) => void sync.patchTarea(id, { status, sort_order: sortOrder })}
                      onAddTask={openTaskForm}
                    />
                  ) : activeView === 'calendar' ? (
                    <CalendarView
                      tareas={filteredTareas}
                      onDateChange={(id, dueDate) => void sync.patchTarea(id, { due_date: dueDate })}
                      onAddTask={openTaskForm}
                    />
                  ) : (
                    <GanttView
                      tareas={filteredTareas}
                      onDatesChange={(id, startDate, dueDate) =>
                        void sync.patchTarea(id, { start_date: startDate, due_date: dueDate })
                      }
                      onAddTask={openTaskForm}
                    />
                  )}
                </div>

                {sync.activeProyecto && (
                  <StatsPanel
                    stats={taskStats}
                    filteredCount={filteredTareas.length}
                    totalCount={sync.tareas.length}
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
        onClose={() => setTaskFormOpen(false)}
        onSubmit={sync.addTarea}
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