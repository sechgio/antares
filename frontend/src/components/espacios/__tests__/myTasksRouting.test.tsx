import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import EspaciosApp from '../EspaciosApp';
import type { MyTask } from '../types';

const mocks = vi.hoisted(() => ({
  patchTarea: vi.fn().mockResolvedValue(undefined),
  reloadMyTasks: vi.fn().mockResolvedValue(undefined),
  fetchBoardColumns: vi.fn().mockResolvedValue([]),
}));

const myTask: MyTask = {
  id: 'global-task', proyecto_id: 'remote-project', title: 'Tarea transversal', description: null,
  status: 'review', status_name: 'En revisión', status_is_done: false, priority: 'high',
  assignee_id: 'user-1', start_date: null, due_date: '2026-09-20', sort_order: 0,
  created_by: 'user-1', created_at: '', updated_at: '', proyecto_name: 'Proyecto remoto',
  espacio_id: 'remote-space', espacio_name: 'Operaciones',
};

vi.mock('../../../auth/AuthContext', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }));
vi.mock('../../../hooks/useDialog', () => ({ useDialog: () => ({ confirm: vi.fn() }) }));
vi.mock('../../../hooks/useToast', () => ({ useToast: () => ({ addToast: vi.fn() }) }));
vi.mock('../hooks/useTeamMembers', () => ({ useTeamMembers: () => ({
  members: [{ user_id: 'user-1', display_name: 'Enzo' }, { user_id: 'user-2', display_name: 'María' }], error: null,
}) }));
vi.mock('../hooks/useMyTasks', () => ({ useMyTasks: () => {
  const [tasks, setTasks] = useState([myTask]);
  return {
    tasks, origins: [myTask], loading: false, loadingMore: false, error: null,
    hasMore: false, hasAssignments: true, loadMore: vi.fn(),
    reload: async () => { mocks.reloadMyTasks(); setTasks([]); },
  };
} }));
vi.mock('../hooks/useEspaciosSync', () => ({ useEspaciosSync: () => ({
  espacios: [{ id: 'space-1', name: 'Actual' }], proyectos: [{ id: 'project-1', espacio_id: 'space-1', name: 'Actual' }],
  tareas: [], boardColumns: [], activeEspacioId: 'space-1', activeProyectoId: 'project-1',
  activeEspacio: { id: 'space-1', name: 'Actual' }, activeProyecto: { id: 'project-1', name: 'Actual' },
  loading: false, tareasLoading: false, error: null, warning: null, realtimeStatus: 'live',
  setActiveEspacioId: vi.fn(), setActiveProyectoId: vi.fn(), clearWarning: vi.fn(),
  patchTarea: mocks.patchTarea, addTarea: vi.fn(),
}) }));
vi.mock('../api/espaciosApi', async (importOriginal) => {
  const original = await importOriginal<typeof import('../api/espaciosApi')>();
  return { ...original, fetchBoardColumns: (...args: unknown[]) => mocks.fetchBoardColumns(...args) };
});
vi.mock('../components/SpaceSidebar', () => ({ default: ({ onSelectMyTasks }: { onSelectMyTasks: () => void }) => (
  <button type="button" onClick={onSelectMyTasks}>Mis tareas</button>
) }));
vi.mock('../components/ProjectHeader', () => ({ default: () => null }));
vi.mock('../components/ViewTabs', () => ({ default: () => null }));
vi.mock('../components/views/ListView', () => ({ default: () => null }));
vi.mock('../components/views/BoardView', () => ({ default: () => null }));
vi.mock('../components/views/TableView', () => ({ default: () => null }));
vi.mock('../components/views/CalendarView', () => ({ default: () => null }));
vi.mock('../components/views/GanttView', () => ({ default: () => null }));
vi.mock('../components/TaskActivityFeed', () => ({ default: () => <div>Actividad compartida</div> }));

beforeEach(() => vi.clearAllMocks());

describe('my tasks routing', () => {
  it('opens and saves a global task through the same T02 drawer', async () => {
    render(<EspaciosApp />);
    fireEvent.click(screen.getByRole('button', { name: 'Mis tareas' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Abrir Tarea transversal' }));
    expect(screen.getByRole('dialog', { name: 'Detalle de tarea' })).toHaveAttribute('data-placement', 'right');
    expect(screen.getByText('Actividad compartida')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Persona asignada' }));
    const listbox = screen.getByRole('listbox', { name: 'Persona asignada' });
    fireEvent.click(within(listbox).getByRole('option', { name: 'María' }));
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() => expect(mocks.patchTarea).toHaveBeenCalledWith('global-task', expect.objectContaining({ assignee_id: 'user-2' })));
    expect(mocks.reloadMyTasks).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Abrir Tarea transversal' })).not.toBeInTheDocument());
  });
});
