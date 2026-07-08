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
const deleteEspacio = vi.fn();
const deleteProyecto = vi.fn();

vi.mock('../api/espaciosApi', () => ({
  fetchEspacios: (...args: unknown[]) => fetchEspacios(...args),
  fetchProyectos: (...args: unknown[]) => fetchProyectos(...args),
  fetchTareas: (...args: unknown[]) => fetchTareas(...args),
  createEspacio: vi.fn(),
  createProyecto: vi.fn(),
  createTarea: vi.fn(),
  updateProyecto: vi.fn(),
  updateTarea: vi.fn(),
  deleteEspacio: (...args: unknown[]) => deleteEspacio(...args),
  deleteProyecto: (...args: unknown[]) => deleteProyecto(...args),
  deleteTarea: vi.fn(),
}));

vi.mock('../api/realtime', () => ({
  subscribeEspaciosSync: vi.fn(() => null),
  unsubscribeEspaciosSync: vi.fn(),
}));

import { useEspaciosSync } from '../hooks/useEspaciosSync';

describe('useEspaciosSync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchEspacios.mockResolvedValue([espacioA, espacioB]);
    fetchProyectos.mockImplementation(async (espacioId: string) =>
      espacioId === 'esp-a' ? [proyectoA] : [proyectoB],
    );
    fetchTareas.mockImplementation(async (proyectoId: string) =>
      proyectoId === 'proy-a' ? [tareaA] : [tareaB],
    );
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
});