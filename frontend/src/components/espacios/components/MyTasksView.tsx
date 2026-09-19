import { CheckCircle2, ListChecks, Loader2, RefreshCw, SearchX } from 'lucide-react';
import Button from '../../ui/Button';
import Input from '../../ui/Input';
import ThemedSelect from '../../ui/ThemedSelect';
import type { MyTask, MyTaskOrigin, MyTasksFilters, TareaPriority } from '../types';
import { formatRelativeDate, localTodayString } from '../utils/dates';
import { groupMyTasks } from '../utils/myTasks';
import { PRIORITY_OPTIONS, priorityDetails } from '../utils/priority';

interface MyTasksViewProps {
  tasks: MyTask[];
  origins: MyTaskOrigin[];
  filters: MyTasksFilters;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  hasMore: boolean;
  hasAssignments: boolean;
  today?: string;
  onFiltersChange: (patch: Partial<MyTasksFilters>) => void;
  onRetry: () => void;
  onLoadMore: () => void;
  onOpenTask: (task: MyTask) => void;
}

const completionOptions = [
  { value: 'open', label: 'Abiertas' },
  { value: 'completed', label: 'Completadas' },
  { value: 'all', label: 'Todas' },
];

function uniqueOptions(tasks: MyTaskOrigin[], idKey: 'espacio_id' | 'proyecto_id', nameKey: 'espacio_name' | 'proyecto_name') {
  const values = new Map<string, string>();
  for (const task of tasks) values.set(task[idKey], task[nameKey]);
  return [...values].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
}

export default function MyTasksView({
  tasks,
  origins,
  filters,
  loading,
  loadingMore,
  error,
  hasMore,
  hasAssignments,
  today = localTodayString(),
  onFiltersChange,
  onRetry,
  onLoadMore,
  onOpenTask,
}: MyTasksViewProps) {
  const spaces = uniqueOptions(origins, 'espacio_id', 'espacio_name');
  const projectSource = filters.espacioId === 'all'
    ? origins
    : origins.filter((task) => task.espacio_id === filters.espacioId);
  const projects = uniqueOptions(projectSource, 'proyecto_id', 'proyecto_name');
  const groups = groupMyTasks(tasks, today);
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <header className="shrink-0 border-b border-[var(--border-subtle)] px-6 py-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[color:color-mix(in_srgb,var(--accent-primary)_10%,transparent)] text-[var(--accent-primary)]">
            <ListChecks className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-[var(--text-primary)]">Mis tareas</h1>
            <p className="text-xs text-[var(--text-muted)]">Trabajo asignado en todos tus espacios y proyectos.</p>
          </div>
        </div>
        <div className="mt-4 grid gap-2 md:grid-cols-5">
          <Input
            value={filters.search}
            onChange={(event) => onFiltersChange({ search: event.target.value })}
            placeholder="Buscar tareas…"
            aria-label="Buscar en mis tareas"
            className="w-full bg-[var(--bg-input)] md:col-span-2"
          />
          <ThemedSelect
            value={filters.priority}
            options={[{ value: 'all', label: 'Todas las prioridades' }, ...PRIORITY_OPTIONS]}
            onChange={(value) => onFiltersChange({ priority: value as TareaPriority | 'all' })}
            aria-label="Filtrar mis tareas por prioridad"
          />
          <ThemedSelect
            value={filters.completion}
            options={completionOptions}
            onChange={(value) => onFiltersChange({ completion: value as MyTasksFilters['completion'] })}
            aria-label="Filtrar mis tareas por estado"
          />
          <div className="grid grid-cols-2 gap-2 md:col-span-5">
            <ThemedSelect
              value={filters.espacioId}
              options={[{ value: 'all', label: 'Todos los espacios' }, ...spaces]}
              onChange={(value) => onFiltersChange({ espacioId: value, proyectoId: 'all' })}
              aria-label="Filtrar mis tareas por espacio"
            />
            <ThemedSelect
              value={filters.proyectoId}
              options={[{ value: 'all', label: 'Todos los proyectos' }, ...projects]}
              onChange={(value) => onFiltersChange({ proyectoId: value })}
              aria-label="Filtrar mis tareas por proyecto"
            />
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        {loading && tasks.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-[var(--text-muted)]" aria-busy="true">
            <Loader2 className="h-5 w-5 animate-spin" /> Cargando tus tareas…
          </div>
        ) : error ? (
          <div className="mx-auto max-w-md rounded-xl border border-[var(--border-subtle)] p-5 text-center">
            <p role="alert" className="text-sm text-[var(--accent-red)]">{error}</p>
            <Button type="button" variant="ghost" size="sm" className="mt-3" onClick={onRetry}>
              <RefreshCw className="h-4 w-4" /> Reintentar
            </Button>
          </div>
        ) : tasks.length === 0 ? (
          <div className="flex flex-col items-center py-16 text-center">
            {hasAssignments ? <SearchX className="h-8 w-8 text-[var(--text-muted)]" /> : <CheckCircle2 className="h-8 w-8 text-[var(--accent-green)]" />}
            <h2 className="mt-3 text-sm font-semibold text-[var(--text-primary)]">
              {hasAssignments ? 'Ninguna tarea coincide con los filtros' : 'No tienes tareas asignadas'}
            </h2>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              {hasAssignments ? 'Prueba con otros criterios.' : 'Las tareas que te asignen aparecerán aquí.'}
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {groups.filter((group) => group.tasks.length > 0).map((group) => (
              <section key={group.key} aria-labelledby={`my-tasks-${group.key}`}>
                <div className="mb-2 flex items-center gap-2">
                  <h2 id={`my-tasks-${group.key}`} className="text-sm font-semibold text-[var(--text-primary)]">{group.label}</h2>
                  <span className="rounded-full bg-[var(--bg-elevated)] px-2 py-0.5 text-[10px] text-[var(--text-muted)]">{group.tasks.length}</span>
                </div>
                <div className="grid gap-2 xl:grid-cols-2">
                  {group.tasks.map((task) => (
                    <Button
                      key={task.id}
                      type="button"
                      variant="card"
                      size="none"
                      onClick={() => onOpenTask(task)}
                      aria-label={`Abrir ${task.title}`}
                    >
                      <p className="truncate text-sm font-semibold text-[var(--text-primary)]">{task.title}</p>
                      <p className="mt-1 text-xs text-[var(--text-secondary)]">
                        {task.status_name} · {priorityDetails(task).label} · {formatRelativeDate(task.due_date, today)}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[var(--text-muted)]">
                        <span>Proyecto: {task.proyecto_name}</span>
                        <span>Espacio: {task.espacio_name}</span>
                      </div>
                    </Button>
                  ))}
                </div>
              </section>
            ))}
            {hasMore && (
              <div className="flex justify-center pt-1">
                <Button type="button" variant="secondary" size="sm" disabled={loadingMore} onClick={onLoadMore}>
                  {loadingMore ? 'Cargando…' : 'Cargar más'}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
