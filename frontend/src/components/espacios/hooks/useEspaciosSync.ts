import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createEspacio,
  createProyecto,
  createTarea,
  deleteEspacio,
  deleteProyecto,
  deleteTarea,
  fetchEspacios,
  fetchProyectos,
  fetchTareas,
  updateEspacio,
  updateProyecto,
  updateTarea,
} from '../api/espaciosApi';
import { pickDefaultColor } from '../utils/colors';
import { subscribeEspaciosSync, unsubscribeEspaciosSync } from '../api/realtime';
import type { Espacio, Proyecto, Tarea, TareaInput } from '../types';

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
  const [activeEspacioId, setActiveEspacioId] = useState<string | null>(null);
  const [activeProyectoId, setActiveProyectoId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const proyectosRequestRef = useRef(0);
  const tareasRequestRef = useRef(0);
  const activeEspacioIdRef = useRef<string | null>(null);
  const activeProyectoIdRef = useRef<string | null>(null);

  useEffect(() => {
    activeEspacioIdRef.current = activeEspacioId;
  }, [activeEspacioId]);

  useEffect(() => {
    activeProyectoIdRef.current = activeProyectoId;
  }, [activeProyectoId]);

  const loadEspacios = useCallback(async () => {
    const data = await fetchEspacios();
    setEspacios(data);
    setError(null);
    setActiveEspacioId((prev) => prev ?? data[0]?.id ?? null);
    return data;
  }, []);

  const loadProyectos = useCallback(async (espacioId: string) => {
    const requestId = ++proyectosRequestRef.current;
    const data = await fetchProyectos(espacioId);
    if (requestId !== proyectosRequestRef.current) return data;
    setProyectos(data);
    if (data.length > 0) {
      setActiveProyectoId((prev) => (prev && data.some((p) => p.id === prev) ? prev : data[0].id));
    } else {
      setActiveProyectoId(null);
      setTareas([]);
    }
    return data;
  }, []);

  const loadTareas = useCallback(async (proyectoId: string) => {
    const requestId = ++tareasRequestRef.current;
    const data = await fetchTareas(proyectoId);
    if (requestId !== tareasRequestRef.current) return data;
    setTareas(data);
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
        return;
      }

      const tareasData = await fetchTareas(proyectoId);
      setTareas(tareasData);
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
      return;
    }
    // Clear nested data immediately so UI never shows stale proyecto/tareas.
    setTareas([]);
    void loadProyectos(activeEspacioId).catch((err) => {
      // Nested load failures must not replace the whole Espacios screen with a
      // fatal error — keep the sidebar usable and surface an empty project list.
      console.error('[espacios] loadProyectos failed:', errorMessage(err, 'Error al cargar proyectos'));
      if (activeEspacioIdRef.current === activeEspacioId) {
        setProyectos([]);
        setActiveProyectoId(null);
        setTareas([]);
      }
    });
  }, [activeEspacioId, loadProyectos]);

  useEffect(() => {
    if (!activeProyectoId) {
      setTareas([]);
      return;
    }
    setTareas([]);
    void loadTareas(activeProyectoId).catch((err) => {
      console.error('[espacios] loadTareas failed:', errorMessage(err, 'Error al cargar tareas'));
      if (activeProyectoIdRef.current === activeProyectoId) {
        setTareas([]);
      }
    });
  }, [activeProyectoId, loadTareas]);

  useEffect(() => {
    if (activeEspacioId && !espacios.some((e) => e.id === activeEspacioId)) {
      setActiveEspacioId(espacios[0]?.id ?? null);
      setActiveProyectoId(null);
      setProyectos([]);
      setTareas([]);
    }
  }, [espacios, activeEspacioId]);

  useEffect(() => {
    if (activeProyectoId && !proyectos.some((p) => p.id === activeProyectoId)) {
      setActiveProyectoId(proyectos[0]?.id ?? null);
      setTareas([]);
    }
  }, [proyectos, activeProyectoId]);

  useEffect(() => {
    const channel = subscribeEspaciosSync(activeEspacioId, activeProyectoId, ({ eventType, table, new: row, old }) => {
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
        setTareas((prev) => mergeById(prev, tarea, eventType));
      }
    });
    return () => unsubscribeEspaciosSync(channel);
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
    setProyectos((prev) => [...prev, proyecto].sort((a, b) => a.name.localeCompare(b.name)));
    setActiveProyectoId(proyecto.id);
  }, [activeEspacioId, proyectos.length]);

  const addTarea = useCallback(
    async (input: TareaInput) => {
      if (!activeProyectoId) {
        throw new Error('Selecciona un proyecto antes de crear una tarea');
      }
      if (!userId) {
        throw new Error('Debes iniciar sesión para crear tareas');
      }
      const tarea = await createTarea(activeProyectoId, input, userId);
      if (!tarea?.id) {
        throw new Error('No se pudo crear la tarea (respuesta vacía de Supabase)');
      }
      setTareas((prev) => [...prev, tarea]);
    },
    [activeProyectoId, userId],
  );

  const patchTarea = useCallback(async (id: string, patch: Partial<TareaInput & Pick<Tarea, 'status'>>) => {
    setTareas((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
    try {
      await updateTarea(id, patch);
    } catch (err) {
      if (activeProyectoId) await loadTareas(activeProyectoId);
      throw err;
    }
  }, [activeProyectoId, loadTareas]);

  const removeTarea = useCallback(async (id: string) => {
    setTareas((prev) => prev.filter((t) => t.id !== id));
    try {
      await deleteTarea(id);
    } catch (err) {
      if (activeProyectoId) await loadTareas(activeProyectoId);
      throw err;
    }
  }, [activeProyectoId, loadTareas]);

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
    activeEspacio,
    activeProyecto,
    activeEspacioId,
    activeProyectoId,
    setActiveEspacioId,
    setActiveProyectoId,
    loading,
    error,
    reloadAll,
    addEspacio,
    addProyecto,
    addTarea,
    patchTarea,
    removeTarea,
    patchEspacio,
    patchProyecto,
    removeEspacio,
    removeProyecto,
  };
}
