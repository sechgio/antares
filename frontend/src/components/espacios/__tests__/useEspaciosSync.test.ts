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
  updateTarea: vi.fn(),
  deleteEspacio: (...args: unknown[]) => deleteEspacio(...args),
  deleteProyecto: (...args: unknown[]) => deleteProyecto(...args),
  deleteTarea: vi.fn(),
}));

vi.mock('../api/realtime', () => ({
  subscribeEspaciosSync: vi.fn((_e, _p, _onChange, onStatus) => {
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
    fetchEspacios.mockResolvedValue([espacioA, espacioB]);
    fetchProyectos.mockImplementation(async (espacioId: string) =>
      espacioId === 'esp-a' ? [proyectoA] : [proyectoB],
    );
    fetchTareas.mockImplementation(async (proyectoId: string) =>
      proyectoId === 'proy-a' ? [tareaA] : [tareaB],
    );
    fetchBoardColumns.mockResolvedValue([]);
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

    // Wait a tick for the nested load to fail
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

    // 1st call: initial project load (stale if it finishes after create)
    // 2nd call: reconcile load after create (server includes the new row)
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
});