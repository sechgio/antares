import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createBoardColumn,
  createEspacio,
  createProyecto,
  createTarea,
  deleteBoardColumn,
  deleteEspacio,
  deleteProyecto,
  deleteTarea,
  fetchBoardColumns,
  fetchEspacios,
  fetchProyectos,
  fetchTareas,
  updateBoardColumn,
  updateEspacio,
  updateProyecto,
  updateTarea,
} from '../api/espaciosApi';
import { pickDefaultColor } from '../utils/colors';
import {
  subscribeEspaciosSync,
  unsubscribeEspaciosSync,
  type RealtimeStatus,
} from '../api/realtime';
import type { BoardColumn, BoardColumnInput, Espacio, Proyecto, Tarea, TareaInput } from '../types';
import { emitDueNotificationsInvalidate } from '../utils/dueNotificationsBus';
import { readEspaciosPrefs, writeEspaciosPrefs } from '../utils/sessionPrefs';
import { fallbackBoardColumns } from '../utils/statusConfig';

function mergeById<T extends { id: string }>(items: T[], item: T, eventType: string): T[] {
  if (eventType === 'DELETE') return items.filter((i) => i.id !== item.id);
  const idx = items.findIndex((i) => i.id === item.id);
  if (idx === -1) return [...items, item];
  const next = [...items];
  next[idx] = item;
  return next;
}

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  if (err && typeof err === 'object' && 'message' in err) {
    const msg = (err as { message?: unknown }).message;
    if (typeof msg === 'string' && msg) return msg;
  }
  return fallback;
}

export function useEspaciosSync(userId: string | undefined) {
  const [espacios, setEspacios] = useState<Espacio[]>([]);
  const [proyectos, setProyectos] = useState<Proyecto[]>([]);
  const [tareas, setTareas] = useState<Tarea[]>([]);
  const [boardColumns, setBoardColumns] = useState<BoardColumn[]>([]);
  const [activeEspacioId, setActiveEspacioId] = useState<string | null>(null);
  const [activeProyectoId, setActiveProyectoId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Non-fatal nested load errors (proyectos/tareas/columns) for UI toast. */
  const [warning, setWarning] = useState<string | null>(null);
  const [realtimeStatus, setRealtimeStatus] = useState<RealtimeStatus>('idle');
  const proyectosRequestRef = useRef(0);
  const tareasRequestRef = useRef(0);
  const columnsRequestRef = useRef(0);
  const activeEspacioIdRef = useRef<string | null>(null);
  const activeProyectoIdRef = useRef<string | null>(null);
  /** Soft-deleted task ids waiting for undo timer / hard delete commit. */
  const pendingDeleteIdsRef = useRef<Set<string>>(new Set());
  const prefs = useRef(readEspaciosPrefs());

  useEffect(() => {
    activeEspacioIdRef.current = activeEspacioId;
    if (activeEspacioId) writeEspaciosPrefs({ activeEspacioId });
  }, [activeEspacioId]);

  useEffect(() => {
    activeProyectoIdRef.current = activeProyectoId;
    writeEspaciosPrefs({ activeProyectoId });
  }, [activeProyectoId]);

  const clearWarning = useCallback(() => setWarning(null), []);

  const loadEspacios = useCallback(async () => {
    const data = await fetchEspacios();
    setEspacios(data);
    setError(null);
    const preferred = prefs.current.activeEspacioId;
    setActiveEspacioId((prev) => {
      if (prev && data.some((e) => e.id === prev)) return prev;
      if (preferred && data.some((e) => e.id === preferred)) return preferred;
      return data[0]?.id ?? null;
    });
    return data;
  }, []);

  const loadProyectos = useCallback(async (espacioId: string) => {
    const requestId = ++proyectosRequestRef.current;
    const data = await fetchProyectos(espacioId);
    if (requestId !== proyectosRequestRef.current) return data;
    setProyectos(data);
    setWarning(null);
    if (data.length > 0) {
      const preferred = prefs.current.activeProyectoId;
      setActiveProyectoId((prev) => {
        if (prev && data.some((p) => p.id === prev)) return prev;
        if (preferred && data.some((p) => p.id === preferred)) return preferred;
        return data[0].id;
      });
    } else {
      setActiveProyectoId(null);
      setTareas([]);
      setBoardColumns([]);
    }
    return data;
  }, []);

  const loadTareas = useCallback(async (proyectoId: string) => {
    const requestId = ++tareasRequestRef.current;
    const data = await fetchTareas(proyectoId);
    if (requestId !== tareasRequestRef.current) return data;
    // Never re-inject soft-deleted tasks while undo window is open.
    const pending = pendingDeleteIdsRef.current;
    setTareas(pending.size ? data.filter((t) => !pending.has(t.id)) : data);
    setWarning(null);
    return data;
  }, []);

  const loadBoardColumns = useCallback(async (proyectoId: string) => {
    const requestId = ++columnsRequestRef.current;
    const data = await fetchBoardColumns(proyectoId);
    if (requestId !== columnsRequestRef.current) return data;
    setBoardColumns(data);
    return data;
  }, []);

  const reloadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const espaciosData = await fetchEspacios();
      setEspacios(espaciosData);
      const currentEspacioId = activeEspacioIdRef.current;
      const espacioId =
        currentEspacioId && espaciosData.some((e) => e.id === currentEspacioId)
          ? currentEspacioId
          : (espaciosData[0]?.id ?? null);
      setActiveEspacioId(espacioId);

      if (!espacioId) {
        setProyectos([]);
        setActiveProyectoId(null);
        setTareas([]);
        setBoardColumns([]);
        return;
      }

      const proyectosData = await fetchProyectos(espacioId);
      setProyectos(proyectosData);
      const currentProyectoId = activeProyectoIdRef.current;
      const proyectoId =
        currentProyectoId && proyectosData.some((p) => p.id === currentProyectoId)
          ? currentProyectoId
          : (proyectosData[0]?.id ?? null);
      setActiveProyectoId(proyectoId);

      if (!proyectoId) {
        setTareas([]);
        setBoardColumns([]);
        return;
      }

      const [tareasData, columnsData] = await Promise.all([
        fetchTareas(proyectoId),
        fetchBoardColumns(proyectoId),
      ]);
      setTareas(tareasData);
      setBoardColumns(columnsData);
    } catch (err) {
      setError(errorMessage(err, 'Error al cargar ESPACIOS'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    setError(null);
    loadEspacios()
      .catch((err) => setError(errorMessage(err, 'Error al cargar ESPACIOS')))
      .finally(() => setLoading(false));
  }, [loadEspacios]);

  useEffect(() => {
    if (!activeEspacioId) {
      setProyectos([]);
      setActiveProyectoId(null);
      setTareas([]);
      setBoardColumns([]);
      return;
    }
    // Clear nested data immediately so UI never shows stale proyecto/tareas.
    setTareas([]);
    setBoardColumns([]);
    void loadProyectos(activeEspacioId).catch((err) => {
      // Nested load failures must not replace the whole Espacios screen with a
      // fatal error — keep the sidebar usable and surface a non-blocking warning.
      const message = errorMessage(err, 'Error al cargar proyectos');
      console.error('[espacios] loadProyectos failed:', message);
      if (activeEspacioIdRef.current === activeEspacioId) {
        setProyectos([]);
        setActiveProyectoId(null);
        setTareas([]);
        setBoardColumns([]);
        setWarning(message);
      }
    });
  }, [activeEspacioId, loadProyectos]);

  useEffect(() => {
    if (!activeProyectoId) {
      setTareas([]);
      setBoardColumns([]);
      return;
    }
    setTareas([]);
    setBoardColumns(fallbackBoardColumns(activeProyectoId));
    void loadTareas(activeProyectoId).catch((err) => {
      const message = errorMessage(err, 'Error al cargar tareas');
      console.error('[espacios] loadTareas failed:', message);
      if (activeProyectoIdRef.current === activeProyectoId) {
        setTareas([]);
        setWarning(message);
      }
    });
    void loadBoardColumns(activeProyectoId).catch((err) => {
      const message = errorMessage(err, 'Error al cargar columnas del tablero');
      console.error('[espacios] loadBoardColumns failed:', message);
      if (activeProyectoIdRef.current === activeProyectoId) {
        setBoardColumns(fallbackBoardColumns(activeProyectoId));
        setWarning(message);
      }
    });
  }, [activeProyectoId, loadTareas, loadBoardColumns]);

  useEffect(() => {
    if (activeEspacioId && !espacios.some((e) => e.id === activeEspacioId)) {
      setActiveEspacioId(espacios[0]?.id ?? null);
      setActiveProyectoId(null);
      setProyectos([]);
      setTareas([]);
      setBoardColumns([]);
    }
  }, [espacios, activeEspacioId]);

  useEffect(() => {
    if (activeProyectoId && !proyectos.some((p) => p.id === activeProyectoId)) {
      setActiveProyectoId(proyectos[0]?.id ?? null);
      setTareas([]);
      setBoardColumns([]);
    }
  }, [proyectos, activeProyectoId]);

  useEffect(() => {
    const channel = subscribeEspaciosSync(
      activeEspacioId,
      activeProyectoId,
      ({ eventType, table, new: row, old }) => {
        if (table === 'espacios') {
          const espacio = (row ?? old) as unknown as Espacio | null;
          if (!espacio) return;
          setEspacios((prev) => mergeById(prev, espacio, eventType));
        }
        if (table === 'proyectos') {
          const proyecto = (row ?? old) as unknown as Proyecto | null;
          if (!proyecto) return;
          setProyectos((prev) => mergeById(prev, proyecto, eventType));
        }
        if (table === 'tareas') {
          const tarea = (row ?? old) as unknown as Tarea | null;
          if (!tarea) return;
          if (tarea.proyecto_id !== activeProyectoId && eventType !== 'DELETE') return;
          // Soft-deleted tasks must stay hidden until undo or hard commit.
          if (eventType !== 'DELETE' && pendingDeleteIdsRef.current.has(tarea.id)) return;
          setTareas((prev) => mergeById(prev, tarea, eventType));
        }
        if (table === 'board_columns') {
          const col = (row ?? old) as unknown as BoardColumn | null;
          if (!col) return;
          if (col.proyecto_id !== activeProyectoId && eventType !== 'DELETE') return;
          setBoardColumns((prev) => {
            const next = mergeById(prev, col, eventType);
            return [...next].sort((a, b) => a.sort_order - b.sort_order);
          });
        }
      },
      setRealtimeStatus,
    );
    return () => {
      unsubscribeEspaciosSync(channel);
      setRealtimeStatus('idle');
    };
  }, [activeEspacioId, activeProyectoId]);

  const addEspacio = useCallback(
    async (name: string) => {
      if (!userId) {
        throw new Error('Debes iniciar sesión para crear espacios');
      }
      const color = pickDefaultColor(espacios.length);
      const espacio = await createEspacio(name, userId, color);
      if (!espacio?.id) {
        throw new Error('No se pudo crear el espacio (respuesta vacía de Supabase)');
      }
      setEspacios((prev) => [...prev, espacio].sort((a, b) => a.name.localeCompare(b.name)));
      setActiveEspacioId(espacio.id);
      setError(null);
    },
    [userId, espacios.length],
  );

  const addProyecto = useCallback(async (name: string) => {
    if (!activeEspacioId) {
      throw new Error('Selecciona un espacio antes de crear un proyecto');
    }
    const color = pickDefaultColor(proyectos.length + 2);
    const proyecto = await createProyecto(activeEspacioId, name, color);
    if (!proyecto?.id) {
      throw new Error('No se pudo crear el proyecto (respuesta vacía de Supabase)');
    }
    setProyectos((prev) => {
      if (prev.some((p) => p.id === proyecto.id)) {
        return [...prev].sort((a, b) => a.name.localeCompare(b.name));
      }
      return [...prev, proyecto].sort((a, b) => a.name.localeCompare(b.name));
    });
    setActiveProyectoId(proyecto.id);
    // Reconcile: supersede any in-flight load that started before this create.
    void loadProyectos(activeEspacioId).catch((err) => {
      console.error('[espacios] reconcile loadProyectos failed:', errorMessage(err, 'Error al cargar proyectos'));
    });
  }, [activeEspacioId, proyectos.length, loadProyectos]);

  const addTarea = useCallback(
    async (input: TareaInput) => {
      if (!activeProyectoId) {
        throw new Error('Selecciona un proyecto antes de crear una tarea');
      }
      if (!userId) {
        throw new Error('Debes iniciar sesión para crear tareas');
      }
      const proyectoId = activeProyectoId;
      const tarea = await createTarea(proyectoId, input, userId);
      if (!tarea?.id) {
        throw new Error('No se pudo crear la tarea (respuesta vacía de Supabase)');
      }
      setTareas((prev) => (prev.some((t) => t.id === tarea.id) ? prev : [...prev, tarea]));
      emitDueNotificationsInvalidate();
      // Reconcile: supersede any in-flight load that started before this create.
      void loadTareas(proyectoId).catch((err) => {
        console.error('[espacios] reconcile loadTareas failed:', errorMessage(err, 'Error al cargar tareas'));
      });
    },
    [activeProyectoId, userId, loadTareas],
  );

  const patchTarea = useCallback(async (id: string, patch: Partial<TareaInput & Pick<Tarea, 'status'>>) => {
    setTareas((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
    try {
      await updateTarea(id, patch);
      emitDueNotificationsInvalidate();
    } catch (err) {
      if (activeProyectoId) await loadTareas(activeProyectoId);
      throw err;
    }
  }, [activeProyectoId, loadTareas]);

  const removeTarea = useCallback(async (id: string) => {
    setTareas((prev) => prev.filter((t) => t.id !== id));
    try {
      await deleteTarea(id);
      emitDueNotificationsInvalidate();
    } catch (err) {
      if (activeProyectoId) await loadTareas(activeProyectoId);
      throw err;
    }
  }, [activeProyectoId, loadTareas]);

  /** Local-only remove (for undoable delete). Pair with commitDeleteTarea / restoreTarea. */
  const softRemoveTarea = useCallback((id: string) => {
    pendingDeleteIdsRef.current.add(id);
    setTareas((prev) => prev.filter((t) => t.id !== id));
    emitDueNotificationsInvalidate();
  }, []);

  const restoreTarea = useCallback((tarea: Tarea) => {
    pendingDeleteIdsRef.current.delete(tarea.id);
    // Only re-inject into the UI when viewing the task's project (avoid
    // painting a project-A task into project B after a space switch).
    if (activeProyectoIdRef.current && tarea.proyecto_id !== activeProyectoIdRef.current) {
      return;
    }
    setTareas((prev) => {
      if (prev.some((t) => t.id === tarea.id)) return prev;
      return [...prev, tarea].sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at));
    });
    emitDueNotificationsInvalidate();
  }, []);

  const commitDeleteTarea = useCallback(async (id: string) => {
    try {
      await deleteTarea(id);
      pendingDeleteIdsRef.current.delete(id);
      emitDueNotificationsInvalidate();
    } catch (err) {
      pendingDeleteIdsRef.current.delete(id);
      if (activeProyectoId) await loadTareas(activeProyectoId);
      throw err;
    }
  }, [activeProyectoId, loadTareas]);

  const addBoardColumn = useCallback(
    async (input: BoardColumnInput) => {
      if (!activeProyectoId) {
        throw new Error('Selecciona un proyecto antes de crear una columna');
      }
      const proyectoId = activeProyectoId;
      const column = await createBoardColumn(proyectoId, input, boardColumns);
      if (!column?.id) {
        throw new Error('No se pudo crear la columna (respuesta vacía de Supabase)');
      }
      setBoardColumns((prev) => {
        if (prev.some((c) => c.id === column.id)) {
          return [...prev].sort((a, b) => a.sort_order - b.sort_order);
        }
        return [...prev, column].sort((a, b) => a.sort_order - b.sort_order);
      });
      // Reconcile: supersede any in-flight load that started before this create.
      void loadBoardColumns(proyectoId).catch((err) => {
        console.error(
          '[espacios] reconcile loadBoardColumns failed:',
          errorMessage(err, 'Error al cargar columnas'),
        );
      });
      return column;
    },
    [activeProyectoId, boardColumns, loadBoardColumns],
  );

  const patchBoardColumn = useCallback(
    async (id: string, patch: Partial<Pick<BoardColumn, 'name' | 'color' | 'is_done'>>) => {
      setBoardColumns((prev) =>
        prev
          .map((c) => (c.id === id ? { ...c, ...patch } : c))
          .sort((a, b) => a.sort_order - b.sort_order),
      );
      try {
        await updateBoardColumn(id, patch);
        // is_done changes affect which statuses count as open for due notifications.
        if (patch.is_done !== undefined) emitDueNotificationsInvalidate();
      } catch (err) {
        if (activeProyectoId) await loadBoardColumns(activeProyectoId);
        throw err;
      }
    },
    [activeProyectoId, loadBoardColumns],
  );

  const removeBoardColumn = useCallback(
    async (id: string) => {
      const col = boardColumns.find((c) => c.id === id);
      if (!col) return;
      if (col.is_system) {
        throw new Error('No se puede eliminar una columna del sistema');
      }
      if (tareas.some((t) => t.status === col.key)) {
        throw new Error('Mueve o elimina las tareas de esta columna antes de borrarla');
      }
      if (boardColumns.length <= 1) {
        throw new Error('Debe quedar al menos una columna');
      }
      setBoardColumns((prev) => prev.filter((c) => c.id !== id));
      try {
        await deleteBoardColumn(id);
      } catch (err) {
        if (activeProyectoId) await loadBoardColumns(activeProyectoId);
        throw err;
      }
    },
    [boardColumns, tareas, activeProyectoId, loadBoardColumns],
  );

  const removeEspacio = useCallback(
    async (id: string) => {
      const remaining = espacios.filter((e) => e.id !== id);
      setEspacios(remaining);
      if (activeEspacioId === id) {
        const nextId = remaining[0]?.id ?? null;
        setActiveEspacioId(nextId);
        setActiveProyectoId(null);
        setProyectos([]);
        setTareas([]);
        setBoardColumns([]);
      }
      try {
        await deleteEspacio(id);
      } catch (err) {
        await loadEspacios();
        throw err;
      }
    },
    [espacios, activeEspacioId, loadEspacios],
  );

  const removeProyecto = useCallback(
    async (id: string) => {
      const remaining = proyectos.filter((p) => p.id !== id);
      setProyectos(remaining);
      if (activeProyectoId === id) {
        setActiveProyectoId(remaining[0]?.id ?? null);
        setTareas([]);
        setBoardColumns([]);
      }
      try {
        await deleteProyecto(id);
      } catch (err) {
        if (activeEspacioId) await loadProyectos(activeEspacioId);
        throw err;
      }
    },
    [proyectos, activeProyectoId, activeEspacioId, loadProyectos],
  );

  const patchEspacio = useCallback(async (id: string, patch: Partial<Pick<Espacio, 'name' | 'color'>>) => {
    setEspacios((prev) => {
      const next = prev.map((e) => (e.id === id ? { ...e, ...patch } : e));
      return patch.name !== undefined ? [...next].sort((a, b) => a.name.localeCompare(b.name)) : next;
    });
    try {
      await updateEspacio(id, patch);
    } catch (err) {
      await loadEspacios();
      throw err;
    }
  }, [loadEspacios]);

  const patchProyecto = useCallback(async (id: string, patch: Partial<Pick<Proyecto, 'name' | 'color' | 'is_favorite'>>) => {
    setProyectos((prev) => {
      const next = prev.map((p) => (p.id === id ? { ...p, ...patch } : p));
      return patch.name !== undefined ? [...next].sort((a, b) => a.name.localeCompare(b.name)) : next;
    });
    try {
      await updateProyecto(id, patch);
    } catch (err) {
      if (activeEspacioId) await loadProyectos(activeEspacioId);
      throw err;
    }
  }, [activeEspacioId, loadProyectos]);

  const activeEspacio = espacios.find((e) => e.id === activeEspacioId) ?? null;
  const activeProyecto = proyectos.find((p) => p.id === activeProyectoId) ?? null;

  return {
    espacios,
    proyectos,
    tareas,
    boardColumns,
    activeEspacio,
    activeProyecto,
    activeEspacioId,
    activeProyectoId,
    setActiveEspacioId,
    setActiveProyectoId,
    loading,
    error,
    warning,
    clearWarning,
    realtimeStatus,
    reloadAll,
    addEspacio,
    addProyecto,
    addTarea,
    addBoardColumn,
    patchBoardColumn,
    removeBoardColumn,
    patchTarea,
    removeTarea,
    softRemoveTarea,
    restoreTarea,
    commitDeleteTarea,
    patchEspacio,
    patchProyecto,
    removeEspacio,
    removeProyecto,
  };
}
