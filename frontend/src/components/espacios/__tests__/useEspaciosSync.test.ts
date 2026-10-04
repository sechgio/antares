import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Espacio, Proyecto, Tarea } from '../types';

const espacioA: Espacio = {
  id: 'esp-a',
  name: 'Alpha',
  color: null,
  created_by: 'user-1',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const espacioB: Espacio = {
  id: 'esp-b',
  name: 'Beta',
  color: null,
  created_by: 'user-1',
  created_at: '2026-01-02T00:00:00Z',
  updated_at: '2026-01-02T00:00:00Z',
};

const proyectoA: Proyecto = {
  id: 'proy-a',
  espacio_id: 'esp-a',
  name: 'Proyecto A',
  color: null,
  is_favorite: false,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const proyectoB: Proyecto = {
  id: 'proy-b',
  espacio_id: 'esp-b',
  name: 'Proyecto B',
  color: null,
  is_favorite: false,
  created_at: '2026-01-02T00:00:00Z',
  updated_at: '2026-01-02T00:00:00Z',
};

const tareaA: Tarea = {
  id: 'tarea-a',
  proyecto_id: 'proy-a',
  title: 'Tarea A',
  description: null,
  status: 'todo',
  assignee_id: null,
  start_date: null,
  due_date: null,
  sort_order: 0,
  created_by: 'user-1',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const tareaB: Tarea = {
  id: 'tarea-b',
  proyecto_id: 'proy-b',
  title: 'Tarea B',
  description: null,
  status: 'todo',
  assignee_id: null,
  start_date: null,
  due_date: null,
  sort_order: 0,
  created_by: 'user-1',
  created_at: '2026-01-02T00:00:00Z',
  updated_at: '2026-01-02T00:00:00Z',
};

const fetchEspacios = vi.fn();
const fetchProyectos = vi.fn();
const fetchTareas = vi.fn();
const fetchBoardColumns = vi.fn();
const createTarea = vi.fn();
const createProyecto = vi.fn();
const createBoardColumn = vi.fn();
const deleteEspacio = vi.fn();
const deleteProyecto = vi.fn();
const updateTarea = vi.fn();

vi.mock('../api/espaciosApi', () => ({
  fetchEspacios: (...args: unknown[]) => fetchEspacios(...args),
  fetchProyectos: (...args: unknown[]) => fetchProyectos(...args),
  fetchTareas: (...args: unknown[]) => fetchTareas(...args),
  fetchBoardColumns: (...args: unknown[]) => fetchBoardColumns(...args),
  createEspacio: vi.fn(),
  createProyecto: (...args: unknown[]) => createProyecto(...args),
  createTarea: (...args: unknown[]) => createTarea(...args),
  createBoardColumn: (...args: unknown[]) => createBoardColumn(...args),
  updateBoardColumn: vi.fn(),
  deleteBoardColumn: vi.fn(),
  updateProyecto: vi.fn(),
  updateTarea: (...args: unknown[]) => updateTarea(...args),
  deleteEspacio: (...args: unknown[]) => deleteEspacio(...args),
  deleteProyecto: (...args: unknown[]) => deleteProyecto(...args),
  deleteTarea: vi.fn(),
}));

let realtimeChange:
  | ((payload: {
      eventType: string;
      table: string;
      new: Record<string, unknown> | null;
      old: Record<string, unknown> | null;
    }) => void)
  | undefined;
let realtimeStatusChange: ((status: 'live' | 'error' | 'offline' | 'connecting') => void) | undefined;

vi.mock('../api/realtime', () => ({
  subscribeEspaciosSync: vi.fn((_e, _p, onChange, onStatus) => {
    realtimeChange = onChange;
    realtimeStatusChange = onStatus;
    onStatus?.('live');
    return null;
  }),
  unsubscribeEspaciosSync: vi.fn(),
}));

import { useEspaciosSync } from '../hooks/useEspaciosSync';

describe('useEspaciosSync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    fetchEspacios.mockReset();
    fetchProyectos.mockReset();
    fetchTareas.mockReset();
    fetchBoardColumns.mockReset();
    updateTarea.mockReset();
    fetchEspacios.mockResolvedValue([espacioA, espacioB]);
    fetchProyectos.mockImplementation(async (espacioId: string) =>
      espacioId === 'esp-a' ? [proyectoA] : [proyectoB],
    );
    fetchTareas.mockImplementation(async (proyectoId: string) =>
      proyectoId === 'proy-a' ? [tareaA] : [tareaB],
    );
    fetchBoardColumns.mockResolvedValue([]);
    updateTarea.mockResolvedValue(tareaA);
  });

  it('keeps project errors after warning dismissal and retries without leaving the context', async () => {
    fetchProyectos.mockRejectedValueOnce(new Error('proyectos down'));
    const { result } = renderHook(() => useEspaciosSync('user-1'));
    await waitFor(() => expect(result.current.proyectosError).toBe('proyectos down'));
    act(() => result.current.clearWarning());
    expect(result.current.proyectosError).toBe('proyectos down');
    expect(result.current.activeEspacioId).toBe('esp-a');
    await act(async () => { await result.current.reloadAll(true); });
    expect(result.current.proyectosError).toBeNull();
    expect(result.current.tareas).toEqual([tareaA]);
  });

  it('keeps task and column errors independent when one load succeeds', async () => {
    fetchTareas.mockRejectedValueOnce(new Error('tareas down'));
    const { result } = renderHook(() => useEspaciosSync('user-1'));
    await waitFor(() => expect(result.current.tareasError).toBe('tareas down'));
    expect(result.current.columnsError).toBeNull();
    fetchBoardColumns.mockRejectedValueOnce(new Error('columnas down'));
    await act(async () => { await result.current.reloadAll(true); });
    expect(result.current.tareasError).toBeNull();
    expect(result.current.columnsError).toBe('columnas down');
    expect(result.current.tareas).toEqual([tareaA]);
  });

  it('reconciles on reconnect without full-page loading or reviving pending deletions', async () => {
    const { result } = renderHook(() => useEspaciosSync('user-1'));
    await waitFor(() => expect(result.current.tareas).toEqual([tareaA]));
    let resolveEspacios: (items: Espacio[]) => void = () => {};
    fetchEspacios.mockImplementationOnce(() => new Promise<Espacio[]>((resolve) => { resolveEspacios = resolve; }));
    act(() => {
      result.current.softRemoveTarea(tareaA.id);
      realtimeStatusChange?.('offline');
      realtimeStatusChange?.('connecting');
      realtimeStatusChange?.('live');
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.refreshing).toBe(true);
    await act(async () => { resolveEspacios([espacioA, espacioB]); });
    await waitFor(() => expect(result.current.refreshing).toBe(false));
    expect(result.current.tareas).toEqual([]);
  });

  it('discards a background reload after switching the selected space', async () => {
    const { result } = renderHook(() => useEspaciosSync('user-1'));
    await waitFor(() => expect(result.current.tareas).toEqual([tareaA]));
    let resolveProyectos: (items: Proyecto[]) => void = () => {};
    fetchProyectos.mockImplementationOnce(() => new Promise<Proyecto[]>((resolve) => { resolveProyectos = resolve; }));
    let reload: Promise<void>;
    act(() => { reload = result.current.reloadAll(true); });
    await waitFor(() => expect(result.current.proyectosLoading).toBe(true));
    act(() => result.current.setActiveEspacioId('esp-b'));
    await waitFor(() => expect(result.current.tareas).toEqual([tareaB]));
    await act(async () => { resolveProyectos([proyectoA]); await reload; });
    expect(result.current.activeEspacioId).toBe('esp-b');
    expect(result.current.proyectos).toEqual([proyectoB]);
    expect(result.current.tareas).toEqual([tareaB]);
  });

  it('keeps existing tasks and selection when a background retry fails', async () => {
    const { result } = renderHook(() => useEspaciosSync('user-1'));
    await waitFor(() => expect(result.current.tareas).toEqual([tareaA]));
    fetchTareas.mockRejectedValueOnce(new Error('tareas down'));
    await act(async () => { await result.current.reloadAll(true); });
    expect(result.current.tareasError).toBe('tareas down');
    expect(result.current.activeProyectoId).toBe('proy-a');
    expect(result.current.tareas).toEqual([tareaA]);
    expect(result.current.loading).toBe(false);
    expect(result.current.refreshing).toBe(false);
  });

  it('does not refetch on repeated live statuses without a disconnection', async () => {
    const { result } = renderHook(() => useEspaciosSync('user-1'));
    await waitFor(() => expect(result.current.tareas).toEqual([tareaA]));
    fetchEspacios.mockClear();
    act(() => { realtimeStatusChange?.('live'); realtimeStatusChange?.('live'); });
    expect(fetchEspacios).not.toHaveBeenCalled();
    expect(result.current.refreshing).toBe(false);
  });

  it('ignores a stale task rejection after switching away and back to the same project', async () => {
    let rejectOldTasks: (error: Error) => void = () => {};
    fetchTareas.mockImplementationOnce(() => new Promise<Tarea[]>((_resolve, reject) => { rejectOldTasks = reject; }));
    const { result } = renderHook(() => useEspaciosSync('user-1'));
    await waitFor(() => expect(result.current.activeProyectoId).toBe('proy-a'));
    act(() => result.current.setActiveEspacioId('esp-b'));
    await waitFor(() => expect(result.current.tareas).toEqual([tareaB]));
    act(() => result.current.setActiveEspacioId('esp-a'));
    await waitFor(() => expect(result.current.tareas).toEqual([tareaA]));
    await act(async () => { rejectOldTasks(new Error('error antiguo')); });
    expect(result.current.tareas).toEqual([tareaA]);
    expect(result.current.tareasError).toBeNull();
    expect(result.current.warning).toBeNull();
  });

  it('keeps background space failures non-fatal during reconnection', async () => {
    const { result } = renderHook(() => useEspaciosSync('user-1'));
    await waitFor(() => expect(result.current.tareas).toEqual([tareaA]));
    fetchEspacios.mockRejectedValueOnce(new Error('espacios down'));
    await act(async () => { realtimeStatusChange?.('offline'); realtimeStatusChange?.('live'); });
    await waitFor(() => expect(result.current.espaciosError).toBe('espacios down'));
    expect(result.current.error).toBeNull();
    expect(result.current.activeProyectoId).toBe('proy-a');
    expect(result.current.tareas).toEqual([tareaA]);
    await act(async () => { await result.current.reloadAll(true); });
    expect(result.current.espaciosError).toBeNull();
  });

  it('does not expose the previous project when loading a different space fails', async () => {
    const { result } = renderHook(() => useEspaciosSync('user-1'));
    await waitFor(() => expect(result.current.tareas).toEqual([tareaA]));
    fetchProyectos.mockRejectedValueOnce(new Error('proyectos down'));
    act(() => result.current.setActiveEspacioId('esp-b'));
    await waitFor(() => expect(result.current.proyectosError).toBe('proyectos down'));
    expect(result.current.activeProyectoId).toBeNull();
    expect(result.current.activeProyecto).toBeNull();
    expect(result.current.proyectos).toEqual([]);
    expect(result.current.tareas).toEqual([]);
    await expect(result.current.addTarea({ title: 'Nueva' })).rejects.toThrow('Selecciona un proyecto');
  });

  it('does not replace a newer saved patch with a late response from an earlier patch', async () => {
    const { result } = renderHook(() => useEspaciosSync('user-1'));
    await waitFor(() => expect(result.current.tareas).toEqual([tareaA]));
    let resolveFirst: (tarea: Tarea) => void = () => {};
    updateTarea.mockImplementationOnce(() => new Promise<Tarea>((resolve) => { resolveFirst = resolve; }));
    let firstSave: Promise<void>;
    act(() => { firstSave = result.current.patchTarea(tareaA.id, { title: 'Actualizada' }); });
    const saved = { ...tareaA, title: 'Actualizada', status: 'in_progress', updated_at: '2026-02-02T00:00:00Z' };
    updateTarea.mockResolvedValueOnce(saved);
    await act(async () => { await result.current.patchTarea(tareaA.id, { status: 'in_progress' }); });
    await act(async () => {
      resolveFirst({ ...tareaA, title: 'Actualizada', updated_at: '2026-02-01T00:00:00Z' });
      await firstSave;
    });
    expect(result.current.tareas).toEqual([saved]);
  });

  it('lets pending task loading finish if reconnect fails before fetching nested resources', async () => {
    let resolveTasks: (items: Tarea[]) => void = () => {};
    fetchTareas.mockImplementationOnce(() => new Promise<Tarea[]>((resolve) => { resolveTasks = resolve; }));
    const { result } = renderHook(() => useEspaciosSync('user-1'));
    await waitFor(() => expect(result.current.tareasLoading).toBe(true));
    fetchEspacios.mockRejectedValueOnce(new Error('espacios down'));
    await act(async () => { realtimeStatusChange?.('offline'); realtimeStatusChange?.('live'); });
    await waitFor(() => expect(result.current.espaciosError).toBe('espacios down'));
    await act(async () => { resolveTasks([tareaA]); });
    expect(result.current.tareasLoading).toBe(false);
    expect(result.current.tareas).toEqual([tareaA]);
  });

  it('passes the expected version and adopts the saved row version', async () => {
    const { result } = renderHook(() => useEspaciosSync('user-1'));
    await waitFor(() => expect(result.current.tareas).toEqual([tareaA]));
    const saved = { ...tareaA, title: 'Nueva', updated_at: '2026-02-01T00:00:00Z' };
    updateTarea.mockResolvedValueOnce(saved);
    await act(async () => { await result.current.patchTarea(tareaA.id, { title: 'Nueva' }, tareaA.updated_at); });
    expect(updateTarea).toHaveBeenCalledWith(tareaA.id, { title: 'Nueva' }, tareaA.updated_at);
    expect(result.current.tareas).toEqual([saved]);
  });

  it('preserves the original save conflict when reconciliation also fails', async () => {
    const { result } = renderHook(() => useEspaciosSync('user-1'));
    await waitFor(() => expect(result.current.tareas).toEqual([tareaA]));
    const conflict = new Error('conflicto');
    updateTarea.mockRejectedValueOnce(conflict);
    fetchTareas.mockRejectedValueOnce(new Error('sin conexión'));
    await act(async () => {
      await expect(result.current.patchTarea(tareaA.id, { title: 'Nueva' }, tareaA.updated_at)).rejects.toBe(conflict);
    });
    expect(result.current.tareas).toEqual([tareaA]);
    expect(result.current.tareasError).toBe('sin conexión');
  });

  it('reloadAll loads nested data using ids resolved by loadEspacios, not stale closure', async () => {
    fetchEspacios.mockRejectedValueOnce(new Error('network'));
    const { result } = renderHook(() => useEspaciosSync('user-1'));

    await waitFor(() => expect(result.current.error).toBe('network'));
    expect(result.current.activeEspacioId).toBeNull();

    fetchEspacios.mockResolvedValue([espacioA]);
    fetchProyectos.mockClear();
    fetchTareas.mockClear();

    await act(async () => {
      await result.current.reloadAll();
    });

    expect(fetchProyectos).toHaveBeenCalledWith('esp-a');
    expect(fetchTareas).toHaveBeenCalledWith('proy-a');
    expect(result.current.tareas).toEqual([tareaA]);
  });

  it('prefers persisted espacio/proyecto when still present in the server list', async () => {
    localStorage.setItem(
      'antares.espacios.prefs',
      JSON.stringify({ activeEspacioId: 'esp-b', activeProyectoId: 'proy-b', activeView: 'board' }),
    );
    const { result } = renderHook(() => useEspaciosSync('user-1'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    await waitFor(() => expect(result.current.activeEspacioId).toBe('esp-b'));
    await waitFor(() => expect(result.current.activeProyectoId).toBe('proy-b'));
    expect(result.current.tareas).toEqual([tareaB]);
  });

  it('surfaces nested load failures as non-fatal warning', async () => {
    const { result } = renderHook(() => useEspaciosSync('user-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    fetchProyectos.mockRejectedValueOnce(new Error('proyectos down'));
    await act(async () => {
      result.current.setActiveEspacioId('esp-b');
    });

    await waitFor(() => expect(result.current.warning).toBe('proyectos down'));
    act(() => {
      result.current.clearWarning();
    });
    expect(result.current.warning).toBeNull();
  });

  it('reloadAll loads proyectos and tareas for the active espacio after initial fetch', async () => {
    const { result } = renderHook(() => useEspaciosSync('user-1'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.activeEspacioId).toBe('esp-a');
    expect(result.current.activeProyectoId).toBe('proy-a');
    expect(result.current.tareas).toEqual([tareaA]);

    fetchEspacios.mockClear();
    fetchProyectos.mockClear();
    fetchTareas.mockClear();

    await act(async () => {
      await result.current.reloadAll();
    });

    expect(fetchEspacios).toHaveBeenCalledTimes(1);
    expect(fetchProyectos).toHaveBeenCalledWith('esp-a');
    expect(fetchTareas).toHaveBeenCalledWith('proy-a');
  });

  it('clears stale tareas immediately when switching espacio', async () => {
    const { result } = renderHook(() => useEspaciosSync('user-1'));

    await waitFor(() => expect(result.current.tareas).toEqual([tareaA]));

    let resolveProyectos: (value: Proyecto[]) => void = () => {};
    fetchProyectos.mockImplementationOnce(
      () =>
        new Promise<Proyecto[]>((resolve) => {
          resolveProyectos = resolve;
        }),
    );

    act(() => {
      result.current.setActiveEspacioId('esp-b');
    });

    expect(result.current.tareas).toEqual([]);

    await act(async () => {
      resolveProyectos([proyectoB]);
      await Promise.resolve();
    });

    await waitFor(() => expect(result.current.tareas).toEqual([tareaB]));
  });

  it('ignores stale proyectos response when switching espacio A→B quickly', async () => {
    const { result } = renderHook(() => useEspaciosSync('user-1'));

    await waitFor(() => expect(result.current.proyectos).toEqual([proyectoA]));

    let resolveSlowA: (value: Proyecto[]) => void = () => {};
    fetchProyectos.mockImplementation((espacioId: string) => {
      if (espacioId === 'esp-a') {
        return new Promise<Proyecto[]>((resolve) => {
          resolveSlowA = resolve;
        });
      }
      return Promise.resolve([proyectoB]);
    });

    act(() => {
      result.current.setActiveEspacioId('esp-b');
    });
    act(() => {
      result.current.setActiveEspacioId('esp-a');
    });
    act(() => {
      result.current.setActiveEspacioId('esp-b');
    });

    await waitFor(() => expect(result.current.proyectos).toEqual([proyectoB]));

    await act(async () => {
      resolveSlowA([proyectoA]);
      await Promise.resolve();
    });

    expect(result.current.proyectos).toEqual([proyectoB]);
    expect(result.current.activeEspacioId).toBe('esp-b');
  });

  it('removeEspacio deletes and selects next espacio', async () => {
    deleteEspacio.mockResolvedValue(undefined);
    const { result } = renderHook(() => useEspaciosSync('user-1'));

    await waitFor(() => expect(result.current.activeEspacioId).toBe('esp-a'));

    await act(async () => {
      await result.current.removeEspacio('esp-a');
    });

    expect(deleteEspacio).toHaveBeenCalledWith('esp-a');
    expect(result.current.espacios).toEqual([espacioB]);
    expect(result.current.activeEspacioId).toBe('esp-b');

    await waitFor(() => expect(result.current.proyectos).toEqual([proyectoB]));
    await waitFor(() => expect(result.current.tareas).toEqual([tareaB]));
  });

  it('removeProyecto deletes and selects next proyecto', async () => {
    deleteProyecto.mockResolvedValue(undefined);
    fetchProyectos.mockResolvedValue([proyectoA, proyectoB]);
    const { result } = renderHook(() => useEspaciosSync('user-1'));

    await waitFor(() => expect(result.current.activeProyectoId).toBe('proy-a'));

    await act(async () => {
      await result.current.removeProyecto('proy-a');
    });

    expect(deleteProyecto).toHaveBeenCalledWith('proy-a');
    expect(result.current.proyectos).toEqual([proyectoB]);
    expect(result.current.activeProyectoId).toBe('proy-b');
    await waitFor(() => expect(result.current.tareas).toEqual([tareaB]));
  });

  it('addEspacio throws when user is not authenticated instead of silent no-op', async () => {
    const { result } = renderHook(() => useEspaciosSync(undefined));

    await waitFor(() => expect(result.current.loading).toBe(false));

    await expect(
      act(async () => {
        await result.current.addEspacio('Nuevo');
      }),
    ).rejects.toThrow(/iniciar sesión/i);
  });

  it('nested loadProyectos failure does not set fatal full-page error', async () => {
    fetchProyectos.mockRejectedValueOnce(new Error('proyectos down'));
    const { result } = renderHook(() => useEspaciosSync('user-1'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    await waitFor(() => expect(result.current.espacios).toEqual([espacioA, espacioB]));

    await waitFor(() => expect(result.current.proyectos).toEqual([]));
    expect(result.current.error).toBeNull();
  });

  it('does not drop a newly created tarea when an in-flight loadTareas resolves later', async () => {
    let resolveSlowTareas: (value: Tarea[]) => void = () => {};
    const created: Tarea = {
      ...tareaA,
      id: 'tarea-new',
      title: 'Creada durante load',
    };

    fetchTareas
      .mockImplementationOnce(
        () =>
          new Promise<Tarea[]>((resolve) => {
            resolveSlowTareas = resolve;
          }),
      )
      .mockImplementationOnce(async () => [tareaA, created]);

    const { result } = renderHook(() => useEspaciosSync('user-1'));
    await waitFor(() => expect(result.current.activeProyectoId).toBe('proy-a'));

    createTarea.mockResolvedValue(created);

    await act(async () => {
      await result.current.addTarea({ title: 'Creada durante load' });
    });
    expect(result.current.tareas.some((t) => t.id === 'tarea-new')).toBe(true);

    await act(async () => {
      resolveSlowTareas([tareaA]);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.tareas.map((t) => t.id).sort()).toEqual(['tarea-a', 'tarea-new']);
    });
  });

  it('does not drop a newly created proyecto when an in-flight loadProyectos resolves later', async () => {
    let resolveSlowProyectos: (value: Proyecto[]) => void = () => {};
    const created: Proyecto = {
      ...proyectoA,
      id: 'proy-new',
      name: 'Proyecto nuevo',
    };

    fetchProyectos
      .mockImplementationOnce(
        () =>
          new Promise<Proyecto[]>((resolve) => {
            resolveSlowProyectos = resolve;
          }),
      )
      .mockImplementationOnce(async () => [proyectoA, created]);

    const { result } = renderHook(() => useEspaciosSync('user-1'));
    await waitFor(() => expect(result.current.activeEspacioId).toBe('esp-a'));

    createProyecto.mockResolvedValue(created);

    await act(async () => {
      await result.current.addProyecto('Proyecto nuevo');
    });
    expect(result.current.proyectos.some((p) => p.id === 'proy-new')).toBe(true);

    await act(async () => {
      resolveSlowProyectos([proyectoA]);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.proyectos.map((p) => p.id).sort()).toEqual(['proy-a', 'proy-new']);
    });
  });

  it('keeps soft-deleted tasks hidden when loadTareas reconciles from server', async () => {
    const { result } = renderHook(() => useEspaciosSync('user-1'));
    await waitFor(() => expect(result.current.tareas).toEqual([tareaA]));

    act(() => {
      result.current.softRemoveTarea('tarea-a');
    });
    expect(result.current.tareas).toEqual([]);

    const created = { ...tareaA, id: 'tarea-new', title: 'Nueva' };
    createTarea.mockResolvedValue(created);
    fetchTareas.mockResolvedValueOnce([tareaA, created]);

    await act(async () => {
      await result.current.addTarea({ title: 'Nueva' });
    });

    expect(result.current.tareas.some((t) => t.id === 'tarea-a')).toBe(false);
    expect(result.current.tareas.some((t) => t.id === 'tarea-new')).toBe(true);
  });

  it('restoreTarea does not inject a task into a different active project', async () => {
    const { result } = renderHook(() => useEspaciosSync('user-1'));
    await waitFor(() => expect(result.current.tareas).toEqual([tareaA]));

    act(() => {
      result.current.softRemoveTarea('tarea-a');
    });

    await act(async () => {
      result.current.setActiveEspacioId('esp-b');
    });
    await waitFor(() => expect(result.current.activeEspacioId).toBe('esp-b'));
    await waitFor(() => expect(result.current.activeProyectoId).toBe('proy-b'));
    await waitFor(() => expect(result.current.tareas).toEqual([tareaB]));

    act(() => {
      result.current.restoreTarea(tareaA);
    });

    expect(result.current.tareas.some((t) => t.id === 'tarea-a')).toBe(false);
    expect(result.current.tareas).toEqual([tareaB]);
  });

  it('addTarea con proyecto destino explícito crea allí y no toca la vista activa', async () => {
    const { result } = renderHook(() => useEspaciosSync('user-1'));
    await waitFor(() => expect(result.current.tareas).toEqual([tareaA]));

    await act(async () => {
      result.current.setActiveEspacioId('esp-b');
    });
    await waitFor(() => expect(result.current.activeProyectoId).toBe('proy-b'));

    createTarea.mockResolvedValue({ ...tareaA, id: 'tarea-a2' });
    fetchTareas.mockClear();

    await act(async () => {
      await result.current.addTarea({ title: 'Tarea A' }, 'proy-a');
    });

    expect(createTarea).toHaveBeenCalledWith('proy-a', { title: 'Tarea A' }, 'user-1');
    expect(fetchTareas).not.toHaveBeenCalled();
    expect(result.current.tareas).toEqual([tareaB]);
  });

  it('applies realtime DELETE events using the primary key carried in `old`', async () => {
    const { result } = renderHook(() => useEspaciosSync('user-1'));
    await waitFor(() => expect(result.current.tareas).toEqual([tareaA]));

    act(() => {
      realtimeChange?.({
        eventType: 'DELETE',
        table: 'tareas',
        new: {},
        old: { id: 'tarea-a' },
      });
    });

    expect(result.current.tareas).toEqual([]);
  });

  it('drops the deleted espacio from a primary-key-only DELETE payload', async () => {
    const { result } = renderHook(() => useEspaciosSync('user-1'));
    await waitFor(() => expect(result.current.espacios).toHaveLength(2));

    act(() => {
      realtimeChange?.({
        eventType: 'DELETE',
        table: 'espacios',
        new: {},
        old: { id: 'esp-b' },
      });
    });

    expect(result.current.espacios).toEqual([espacioA]);
  });

  it('ignores a realtime DELETE event whose `old` row lacks an id', async () => {
    const { result } = renderHook(() => useEspaciosSync('user-1'));
    await waitFor(() => expect(result.current.tareas).toEqual([tareaA]));

    act(() => {
      realtimeChange?.({
        eventType: 'DELETE',
        table: 'tareas',
        new: {},
        old: {},
      });
    });

    expect(result.current.tareas).toEqual([tareaA]);
  });
});