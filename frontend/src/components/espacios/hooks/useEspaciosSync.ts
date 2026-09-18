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
import { reportFrontendError, reportFrontendEvent } from '../../../utils/observability';
import { errorMessage } from '../../../utils/errors';
import { nextRequest } from '../../../utils/async';

function pickActiveId<T extends { id: string }>(
  items: T[],
  currentId: string | null,
  preferredId?: string | null,
): string | null {
  if (currentId && items.some((i) => i.id === currentId)) return currentId;
  if (preferredId && items.some((i) => i.id === preferredId)) return preferredId;
  return items[0]?.id ?? null;
}

function mergeById<T extends { id: string }>(items: T[], item: T, eventType: string): T[] {
  if (eventType === 'DELETE') return items.filter((i) => i.id !== item.id);
  const idx = items.findIndex((i) => i.id === item.id);
  if (idx === -1) return [...items, item];
  const next = [...items];
  next[idx] = item;
  return next;
}

function reportEspaciosSyncError(op: string, err: unknown, fallback: string): string {
  const message = errorMessage(err, fallback);
  reportFrontendError({
    kind: 'sync_error',
    view: `espacios.${op}`,
    name: err instanceof Error ? err.name : 'EspaciosSyncError',
    message,
  });
  return message;
}

function isEspacioRow(row: unknown): row is Espacio {
  return (
    typeof row === 'object'
    && row !== null
    && typeof (row as Espacio).id === 'string'
    && typeof (row as Espacio).name === 'string'
  );
}

function isProyectoRow(row: unknown): row is Proyecto {
  return (
    typeof row === 'object'
    && row !== null
    && typeof (row as Proyecto).id === 'string'
    && typeof (row as Proyecto).espacio_id === 'string'
  );
}

function isTareaRow(row: unknown): row is Tarea {
  return (
    typeof row === 'object'
    && row !== null
    && typeof (row as Tarea).id === 'string'
    && typeof (row as Tarea).proyecto_id === 'string'
    && typeof (row as Tarea).status === 'string'
  );
}

function isBoardColumnRow(row: unknown): row is BoardColumn {
  return (
    typeof row === 'object'
    && row !== null
    && typeof (row as BoardColumn).id === 'string'
    && typeof (row as BoardColumn).proyecto_id === 'string'
    && typeof (row as BoardColumn).key === 'string'
  );
}

export function useEspaciosSync(userId: string | undefined) {
  const [espacios, setEspacios] = useState<Espacio[]>([]);
  const [proyectos, setProyectos] = useState<Proyecto[]>([]);
  const [tareas, setTareas] = useState<Tarea[]>([]);
  const [boardColumns, setBoardColumns] = useState<BoardColumn[]>([]);
  const [activeEspacioId, setActiveEspacioId] = useState<string | null>(null);
  const [activeProyectoId, setActiveProyectoId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tareasLoading, setTareasLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [realtimeStatus, setRealtimeStatus] = useState<RealtimeStatus>('idle');
  const proyectosRequestRef = useRef(0);
  const tareasRequestRef = useRef(0);
  const columnsRequestRef = useRef(0);
  const reloadAllRequestRef = useRef(0);
  const activeEspacioIdRef = useRef<string | null>(null);
  const activeProyectoIdRef = useRef<string | null>(null);
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

  const resetTareasState = useCallback(() => {
    setTareas([]);
    setBoardColumns([]);
    setTareasLoading(false);
  }, []);

  const resetProyectoState = useCallback(() => {
    setProyectos([]);
    setActiveProyectoId(null);
    resetTareasState();
  }, [resetTareasState]);

  const loadEspacios = useCallback(async () => {
    const data = await fetchEspacios();
    setEspacios(data);
    setError(null);
    const preferred = prefs.current.activeEspacioId;
    setActiveEspacioId((prev) => pickActiveId(data, prev, preferred));
    return data;
  }, []);

  const loadProyectos = useCallback(async (espacioId: string) => {
    const guard = nextRequest(proyectosRequestRef);
    const data = await fetchProyectos(espacioId);
    if (!guard.isCurrent()) return data;
    setProyectos(data);
    setWarning(null);
    if (data.length > 0) {
      const preferred = prefs.current.activeProyectoId;
      setActiveProyectoId((prev) => pickActiveId(data, prev, preferred));
    } else {
      setActiveProyectoId(null);
      resetTareasState();
    }
    return data;
  }, [resetTareasState]);

  const loadTareas = useCallback(async (proyectoId: string) => {
    const guard = nextRequest(tareasRequestRef);
    setTareasLoading(true);
    try {
      const data = await fetchTareas(proyectoId);
      if (!guard.isCurrent()) return data;
      const pending = pendingDeleteIdsRef.current;
      setTareas(pending.size ? data.filter((t) => !pending.has(t.id)) : data);
      setWarning(null);
      setTareasLoading(false);
      return data;
    } catch (err) {
      if (guard.isCurrent()) setTareasLoading(false);
      throw err;
    }
  }, []);

  const loadBoardColumns = useCallback(async (proyectoId: string) => {
    const guard = nextRequest(columnsRequestRef);
    const data = await fetchBoardColumns(proyectoId);
    if (!guard.isCurrent()) return data;
    setBoardColumns(data);
    return data;
  }, []);

  const reloadAll = useCallback(async () => {
    const guard = nextRequest(reloadAllRequestRef);
    proyectosRequestRef.current = guard.id;
    tareasRequestRef.current = guard.id;
    columnsRequestRef.current = guard.id;
    setLoading(true);
    setError(null);
    try {
      const espaciosData = await fetchEspacios();
      if (!guard.isCurrent()) return;
      setEspacios(espaciosData);
      const espacioId = pickActiveId(espaciosData, activeEspacioIdRef.current);
      setActiveEspacioId(espacioId);

      if (!espacioId) {
        resetProyectoState();
        return;
      }

      const proyectosData = await fetchProyectos(espacioId);
      if (!guard.isCurrent()) return;
      setProyectos(proyectosData);
      const proyectoId = pickActiveId(proyectosData, activeProyectoIdRef.current);
      setActiveProyectoId(proyectoId);

      if (!proyectoId) {
        resetTareasState();
        return;
      }

      setTareasLoading(true);
      const [tareasData, columnsData] = await Promise.all([
        fetchTareas(proyectoId),
        fetchBoardColumns(proyectoId),
      ]);
      if (!guard.isCurrent()) return;
      setTareas(tareasData);
      setBoardColumns(columnsData);
      setTareasLoading(false);
    } catch (err) {
      if (!guard.isCurrent()) return;
      setError(errorMessage(err, 'Error al cargar ESPACIOS'));
      setTareasLoading(false);
    } finally {
      if (guard.isCurrent()) {
        setLoading(false);
      }
    }
  }, [resetProyectoState, resetTareasState]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    loadEspacios()
      .catch((err) => setError(reportEspaciosSyncError('loadEspacios', err, 'Error al cargar ESPACIOS')))
      .finally(() => setLoading(false));
  }, [loadEspacios]);

  useEffect(() => {
    if (!activeEspacioId) {
      resetProyectoState();
      return;
    }
    resetTareasState();
    void loadProyectos(activeEspacioId).catch((err) => {
      const message = reportEspaciosSyncError('loadProyectos', err, 'Error al cargar proyectos');
      if (activeEspacioIdRef.current === activeEspacioId) {
        resetProyectoState();
        setWarning(message);
      }
    });
  }, [activeEspacioId, loadProyectos, resetProyectoState]);

  useEffect(() => {
    if (!activeProyectoId) {
      resetTareasState();
      return;
    }
    setTareas([]);
    setBoardColumns(fallbackBoardColumns(activeProyectoId));
    setTareasLoading(true);
    void loadTareas(activeProyectoId).catch((err) => {
      const message = reportEspaciosSyncError('loadTareas', err, 'Error al cargar tareas');
      if (activeProyectoIdRef.current === activeProyectoId) {
        setTareas([]);
        setWarning(message);
      }
    });
    void loadBoardColumns(activeProyectoId).catch((err) => {
      const message = reportEspaciosSyncError('loadBoardColumns', err, 'Error al cargar columnas del tablero');
      if (activeProyectoIdRef.current === activeProyectoId) {
        setBoardColumns(fallbackBoardColumns(activeProyectoId));
        setWarning(message);
      }
    });
  }, [activeProyectoId, loadTareas, loadBoardColumns, resetTareasState]);

  useEffect(() => {
    if (activeEspacioId && !espacios.some((e) => e.id === activeEspacioId)) {
      setActiveEspacioId(espacios[0]?.id ?? null);
      resetProyectoState();
    }
  }, [espacios, activeEspacioId, resetProyectoState]);

  useEffect(() => {
    if (activeProyectoId && !proyectos.some((p) => p.id === activeProyectoId)) {
      setActiveProyectoId(proyectos[0]?.id ?? null);
      resetTareasState();
    }
  }, [proyectos, activeProyectoId, resetTareasState]);

  useEffect(() => {
    const channel = subscribeEspaciosSync(
      activeEspacioId,
      activeProyectoId,
      ({ eventType, table, new: row, old }) => {
        // DELETE events only carry the primary key in `old` (REPLICA IDENTITY
        // DEFAULT), so resolve them by id instead of validating a full row.
        if (eventType === 'DELETE') {
          const id = old?.id;
          if (typeof id !== 'string') return;
          if (table === 'espacios') setEspacios((prev) => prev.filter((e) => e.id !== id));
          if (table === 'proyectos') setProyectos((prev) => prev.filter((p) => p.id !== id));
          if (table === 'tareas') setTareas((prev) => prev.filter((t) => t.id !== id));
          if (table === 'board_columns') {
            setBoardColumns((prev) => prev.filter((c) => c.id !== id));
          }
          return;
        }
        if (table === 'espacios') {
          const espacio = row;
          if (!isEspacioRow(espacio)) return;
          setEspacios((prev) => mergeById(prev, espacio, eventType));
        }
        if (table === 'proyectos') {
          const proyecto = row;
          if (!isProyectoRow(proyecto)) return;
          setProyectos((prev) => mergeById(prev, proyecto, eventType));
        }
        if (table === 'tareas') {
          const tarea = row;
          if (!isTareaRow(tarea)) return;
          if (tarea.proyecto_id !== activeProyectoId) return;
          if (pendingDeleteIdsRef.current.has(tarea.id)) return;
          setTareas((prev) => mergeById(prev, tarea, eventType));
        }
        if (table === 'board_columns') {
          const col = row;
          if (!isBoardColumnRow(col)) return;
          if (col.proyecto_id !== activeProyectoId) return;
          setBoardColumns((prev) => {
            const next = mergeById(prev, col, eventType);
            return [...next].sort((a, b) => a.sort_order - b.sort_order);
          });
        }
      },
      (status) => {
        setRealtimeStatus(status);
        if (status === 'live' || status === 'error' || status === 'offline') {
          reportFrontendEvent({
            event: 'espacios.sync',
            level: status === 'error' ? 'WARN' : 'DEBUG',
            status,
            outcome: status === 'live' ? 'success' : status === 'error' ? 'failed' : undefined,
            view: 'espacios',
          });
        }
      },
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
    void loadProyectos(activeEspacioId).catch((err) => {
      reportEspaciosSyncError('reconcileProyectos', err, 'Error al cargar proyectos');
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
      void loadTareas(proyectoId).catch((err) => {
        reportEspaciosSyncError('reconcileTareas', err, 'Error al cargar tareas');
      });
    },
    [activeProyectoId, userId, loadTareas],
  );

  const reloadActiveProyecto = useCallback(
    async (reload: (proyectoId: string) => Promise<unknown>) => {
      if (activeProyectoId) await reload(activeProyectoId);
    },
    [activeProyectoId],
  );

  const patchTarea = useCallback(async (id: string, patch: Partial<TareaInput & Pick<Tarea, 'status'>>) => {
    setTareas((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
    try {
      await updateTarea(id, patch);
      emitDueNotificationsInvalidate();
    } catch (err) {
      await reloadActiveProyecto(loadTareas);
      throw err;
    }
  }, [reloadActiveProyecto, loadTareas]);

  const removeTarea = useCallback(async (id: string) => {
    setTareas((prev) => prev.filter((t) => t.id !== id));
    try {
      await deleteTarea(id);
      emitDueNotificationsInvalidate();
    } catch (err) {
      await reloadActiveProyecto(loadTareas);
      throw err;
    }
  }, [reloadActiveProyecto, loadTareas]);

  const softRemoveTarea = useCallback((id: string) => {
    pendingDeleteIdsRef.current.add(id);
    setTareas((prev) => prev.filter((t) => t.id !== id));
    emitDueNotificationsInvalidate();
  }, []);

  const restoreTarea = useCallback((tarea: Tarea) => {
    pendingDeleteIdsRef.current.delete(tarea.id);
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
      await reloadActiveProyecto(loadTareas);
      throw err;
    }
  }, [reloadActiveProyecto, loadTareas]);

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
      void loadBoardColumns(proyectoId).catch((err) => {
        reportEspaciosSyncError('reconcileBoardColumns', err, 'Error al cargar columnas');
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
        if (patch.is_done !== undefined) emitDueNotificationsInvalidate();
      } catch (err) {
        await reloadActiveProyecto(loadBoardColumns);
        throw err;
      }
    },
    [reloadActiveProyecto, loadBoardColumns],
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
        await reloadActiveProyecto(loadBoardColumns);
        throw err;
      }
    },
    [boardColumns, tareas, reloadActiveProyecto, loadBoardColumns],
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
    tareasLoading,
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
