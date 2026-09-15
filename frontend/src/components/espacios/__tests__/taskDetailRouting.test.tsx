import { useEffect } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import EspaciosApp from '../EspaciosApp';
import type { Tarea, VistaType } from '../types';

const mocks = vi.hoisted(() => ({
  patchTarea: vi.fn().mockResolvedValue(undefined),
  addTarea: vi.fn().mockResolvedValue(undefined),
  mounts: 0,
  task: {
    id: 'task-1', proyecto_id: 'project-1', title: 'Informe', description: null,
    status: 'in_progress', priority: 'high' as const, assignee_id: 'user-1',
    start_date: null, due_date: null, sort_order: 1,
    created_by: 'user-1', created_at: '', updated_at: '',
  },
}));

vi.mock('../../../auth/AuthContext', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }));
vi.mock('../../../hooks/useDialog', () => ({ useDialog: () => ({ confirm: vi.fn() }) }));
vi.mock('../../../hooks/useToast', () => ({ useToast: () => ({ addToast: vi.fn() }) }));
vi.mock('../hooks/useTeamMembers', () => ({ useTeamMembers: () => ({ members: [], error: null }) }));
vi.mock('../hooks/useEspaciosSync', () => ({ useEspaciosSync: () => ({
  espacios: [{ id: 'space-1', name: 'Operaciones' }],
  proyectos: [{ id: 'project-1', espacio_id: 'space-1', name: 'Entrega semanal' }],
  tareas: [mocks.task], boardColumns: [],
  activeEspacioId: 'space-1', activeProyectoId: 'project-1',
  activeEspacio: { id: 'space-1', name: 'Operaciones' },
  activeProyecto: { id: 'project-1', espacio_id: 'space-1', name: 'Entrega semanal' },
  loading: false, tareasLoading: false, error: null, warning: null, realtimeStatus: 'SUBSCRIBED',
  setActiveEspacioId: vi.fn(), setActiveProyectoId: vi.fn(), clearWarning: vi.fn(),
  patchTarea: mocks.patchTarea, addTarea: mocks.addTarea,
}) }));
vi.mock('../components/SpaceSidebar', () => ({ default: () => null }));
vi.mock('../components/EspaciosWelcome', () => ({ default: () => null }));
vi.mock('../components/ProjectHeader', () => ({ default: () => <h1>Entrega semanal</h1> }));
vi.mock('../components/ViewTabs', () => ({ default: ({ active, onChange }: {
  active: VistaType; onChange: (view: VistaType) => void;
}) => <div>{(['list', 'board', 'table', 'calendar', 'gantt'] as const).map((view) =>
  <button key={view} aria-pressed={view === active} onClick={() => onChange(view)}>Vista {view}</button>,
)}</div> }));

// Only the large project renderers are replaced. The app routing, filters,
// TaskForm, drawer and input controls are real in these integration tests.
function ProjectView({ tareas, onEdit, onEditTask }: {
  tareas: Tarea[]; onEdit?: (task: Tarea) => void; onEditTask?: (task: Tarea) => void;
}) {
  useEffect(() => { mocks.mounts += 1; }, []);
  return <div data-testid="project-view">{tareas.map((task) =>
    <button key={task.id} onClick={() => (onEdit ?? onEditTask)?.(task)}>Abrir {task.title}</button>,
  )}</div>;
}
vi.mock('../components/views/ListView', () => ({ default: ProjectView }));
vi.mock('../components/views/BoardView', () => ({ default: ProjectView }));
vi.mock('../components/views/TableView', () => ({ default: ProjectView }));
vi.mock('../components/views/CalendarView', () => ({ default: ProjectView }));
vi.mock('../components/views/GanttView', () => ({ default: ProjectView }));

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  mocks.mounts = 0;
});
afterEach(cleanup);

describe('shared task detail routing', () => {
  it.each(['list', 'board', 'table', 'calendar', 'gantt'] as const)(
    'opens and saves from %s without resetting project context', async (view) => {
      render(<EspaciosApp />);
      fireEvent.click(screen.getByRole('button', { name: `Vista ${view}` }));
      fireEvent.change(screen.getByLabelText('Buscar tareas'), { target: { value: 'Informe' } });
      const projectView = await screen.findByTestId('project-view');
      const scroller = projectView.parentElement!;
      scroller.scrollTop = 120;
      const mountsBeforeOpen = mocks.mounts;
      fireEvent.click(await screen.findByRole('button', { name: 'Abrir Informe' }));
      expect(screen.getByRole('dialog', { name: 'Detalle de tarea' })).toHaveAttribute('data-placement', 'right');
      fireEvent.change(screen.getByLabelText('Descripción'), { target: { value: 'Revisado' } });
      fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(mocks.patchTarea).toHaveBeenCalledWith('task-1', expect.objectContaining({
        description: 'Revisado', priority: 'high', status: 'in_progress',
      }));
      expect(screen.getByTestId('project-view')).toBe(projectView);
      expect(mocks.mounts).toBe(mountsBeforeOpen);
      expect(scroller.scrollTop).toBe(120);
      expect(screen.getByLabelText('Buscar tareas')).toHaveValue('Informe');
      expect(screen.getByRole('button', { name: `Vista ${view}` })).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByRole('heading', { name: 'Entrega semanal' })).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Nueva tarea' }));
      expect(screen.getByRole('dialog', { name: 'Nueva tarea' })).toHaveAttribute('data-placement', 'center');
      expect(screen.getByLabelText('Título')).toHaveValue('');
    },
  );
});
