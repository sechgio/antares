import { supabase } from '../../../lib/supabase';
import type {
  BoardColumn,
  BoardColumnInput,
  Espacio,
  MyTask,
  MyTaskOrigin,
  MyTasksFilters,
  Proyecto,
  Tarea,
  TaskActivity,
  TaskComment,
  TareaInput,
  TeamMember,
} from '../types';
import { DEFAULT_MY_TASKS_FILTERS } from '../types';
import { isTareaPriority, tareaPriority } from '../utils/priority';
import {
  fallbackBoardColumns,
  nextColumnColor,
  nextColumnSortOrder,
  uniqueColumnKey,
} from '../utils/statusConfig';

function requireClient() {
  if (!supabase) throw new Error('Supabase no configurado');
  return supabase;
}

function throwOnError(error: { message?: string; code?: string } | null): void {
  if (!error) return;
  if ((error.code === '42703' || error.code === 'PGRST204') && /priority/i.test(error.message ?? '')) {
    throw new Error('Falta aplicar la migración de prioridad de Espacios. Contacta al administrador; no se guardaron los cambios.');
  }
  const code = error.code ? ` [${error.code}]` : '';
  throw new Error((error.message || 'Error de Supabase') + code);
}

function requireData<T>(data: T | null, action: string): T {
  if (data == null) throw new Error(`${action}: respuesta vacía de Supabase`);
  return data;
}

async function deleteById(table: string, id: string): Promise<void> {
  const client = requireClient();
  const { error } = await client.from(table).delete().eq('id', id);
  throwOnError(error);
}

export async function fetchEspacios(): Promise<Espacio[]> {
  const client = requireClient();
  const { data, error } = await client.from('espacios').select('*').order('name');
  throwOnError(error);
  return data ?? [];
}

export async function deleteEspacio(id: string): Promise<void> {
  return deleteById('espacios', id);
}

export async function createEspacio(name: string, userId: string, color?: string): Promise<Espacio> {
  const client = requireClient();
  const { data, error } = await client
    .from('espacios')
    .insert({ name, created_by: userId, color: color ?? null })
    .select('*')
    .single();
  throwOnError(error);
  return requireData(data, 'Crear espacio');
}

export async function updateEspacio(
  id: string,
  patch: Partial<Pick<Espacio, 'name' | 'color'>>,
): Promise<Espacio> {
  const client = requireClient();
  const { data, error } = await client.from('espacios').update(patch).eq('id', id).select('*').single();
  throwOnError(error);
  return requireData(data, 'Actualizar espacio');
}

export async function fetchProyectos(espacioId: string): Promise<Proyecto[]> {
  const client = requireClient();
  const { data, error } = await client
    .from('proyectos')
    .select('*')
    .eq('espacio_id', espacioId)
    .order('name');
  throwOnError(error);
  return data ?? [];
}

export async function createProyecto(espacioId: string, name: string, color?: string): Promise<Proyecto> {
  const client = requireClient();
  const { data, error } = await client
    .from('proyectos')
    .insert({ espacio_id: espacioId, name, color: color ?? null })
    .select('*')
    .single();
  throwOnError(error);
  return requireData(data, 'Crear proyecto');
}

export async function deleteProyecto(id: string): Promise<void> {
  return deleteById('proyectos', id);
}

export async function updateProyecto(
  id: string,
  patch: Partial<Pick<Proyecto, 'name' | 'color' | 'is_favorite'>>,
): Promise<Proyecto> {
  const client = requireClient();
  const { data, error } = await client.from('proyectos').update(patch).eq('id', id).select('*').single();
  throwOnError(error);
  return requireData(data, 'Actualizar proyecto');
}

export async function fetchTareas(proyectoId: string): Promise<Tarea[]> {
  const client = requireClient();
  const { data, error } = await client
    .from('tareas')
    .select(
      'id, proyecto_id, title, description, status, priority, assignee_id, start_date, due_date, sort_order, created_by, created_at, updated_at',
    )
    .eq('proyecto_id', proyectoId)
    .order('sort_order')
    .order('created_at');
  throwOnError(error);
  return data ?? [];
}

export interface DueSoonTareaRow {
  id: string;
  title: string;
  due_date: string;
  status: string;
  proyecto_id: string;
  proyecto_name: string;
  espacio_id: string | null;
  espacio_name: string | null;
}

type ProyectoJoin = {
  name?: string | null;
  espacio_id?: string | null;
  espacios?: { name?: string | null } | { name?: string | null }[] | null;
} | null;

function unwrapJoin<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export async function fetchDueSoonTareas(horizonIso: string): Promise<DueSoonTareaRow[]> {
  const client = requireClient();
  const { data, error } = await client
    .from('tareas')
    .select('id, title, due_date, status, proyecto_id, proyectos(name, espacio_id, espacios(name))')
    .not('due_date', 'is', null)
    .lte('due_date', horizonIso)
    .order('due_date', { ascending: true })
    .limit(80);
  throwOnError(error);

  const rows = (data ?? [])
    .filter((row): row is typeof row & { due_date: string } => typeof row.due_date === 'string')
    .map((row) => {
      const proyecto = unwrapJoin(row.proyectos as ProyectoJoin);
      const espacio = unwrapJoin(proyecto?.espacios ?? null);
      return {
        id: row.id as string,
        title: (row.title as string) ?? '',
        due_date: row.due_date,
        status: (row.status as string) ?? 'todo',
        proyecto_id: row.proyecto_id as string,
        proyecto_name: proyecto?.name?.trim() || 'Proyecto',
        espacio_id: proyecto?.espacio_id ?? null,
        espacio_name: espacio?.name ?? null,
      };
    });

  const proyectoIds = [...new Set(rows.map((r) => r.proyecto_id))];
  if (proyectoIds.length === 0) return rows;

  const { data: doneCols, error: doneColsError } = await client
    .from('board_columns')
    .select('proyecto_id, key')
    .in('proyecto_id', proyectoIds)
    .eq('is_done', true);

  if (doneColsError || !doneCols) {
    return rows.filter((r) => r.status !== 'done' && r.status !== 'closed');
  }

  const doneKeysByProyecto = new Map<string, Set<string>>();
  for (const col of doneCols as Array<{ proyecto_id: string; key: string }>) {
    let set = doneKeysByProyecto.get(col.proyecto_id);
    if (!set) {
      set = new Set<string>();
      doneKeysByProyecto.set(col.proyecto_id, set);
    }
    set.add(col.key);
  }

  return rows.filter((row) => {
    const keys = doneKeysByProyecto.get(row.proyecto_id);
    if (keys && keys.size > 0) return !keys.has(row.status);
    return row.status !== 'done' && row.status !== 'closed';
  });
}

export async function createTarea(proyectoId: string, input: TareaInput, userId: string): Promise<Tarea> {
  if (input.priority !== undefined && !isTareaPriority(input.priority)) {
    throw new Error('Prioridad de tarea no válida');
  }
  const client = requireClient();
  const { data, error } = await client
    .from('tareas')
    .insert({
      proyecto_id: proyectoId,
      title: input.title,
      description: input.description ?? null,
      status: input.status ?? 'todo',
      priority: tareaPriority({ status: input.status ?? 'todo', priority: input.priority }),
      assignee_id: input.assignee_id ?? null,
      start_date: input.start_date ?? null,
      due_date: input.due_date ?? null,
      sort_order: input.sort_order ?? Date.now(),
      created_by: userId,
    })
    .select('*')
    .single();
  throwOnError(error);
  return requireData(data, 'Crear tarea');
}

export async function updateTarea(id: string, patch: Partial<TareaInput & Pick<Tarea, 'status'>>): Promise<Tarea> {
  if (patch.priority !== undefined && !isTareaPriority(patch.priority)) {
    throw new Error('Prioridad de tarea no válida');
  }
  const client = requireClient();
  const { data, error } = await client.from('tareas').update(patch).eq('id', id).select('*').single();
  throwOnError(error);
  return requireData(data, 'Actualizar tarea');
}

export async function deleteTarea(id: string): Promise<void> {
  return deleteById('tareas', id);
}

export async function fetchTaskComments(tareaId: string): Promise<TaskComment[]> {
  const client = requireClient();
  const { data, error } = await client
    .from('tarea_comments')
    .select('id, tarea_id, author_id, author_name, body, created_at, updated_at')
    .eq('tarea_id', tareaId)
    .order('created_at', { ascending: true });
  throwOnError(error);
  return (data ?? []) as TaskComment[];
}

export async function createTaskComment(
  tareaId: string,
  body: string,
  userId: string,
): Promise<TaskComment> {
  const trimmed = body.trim();
  if (!trimmed) throw new Error('No puedes enviar un comentario vacío');
  const client = requireClient();
  const { data, error } = await client
    .from('tarea_comments')
    .insert({ tarea_id: tareaId, body: trimmed, author_id: userId })
    .select('id, tarea_id, author_id, author_name, body, created_at, updated_at')
    .single();
  throwOnError(error);
  return requireData(data as TaskComment | null, 'Crear comentario');
}

export async function updateTaskComment(id: string, body: string): Promise<TaskComment> {
  const trimmed = body.trim();
  if (!trimmed) throw new Error('No puedes guardar un comentario vacío');
  const client = requireClient();
  const { data, error } = await client
    .from('tarea_comments')
    .update({ body: trimmed })
    .eq('id', id)
    .select('id, tarea_id, author_id, author_name, body, created_at, updated_at')
    .single();
  throwOnError(error);
  return requireData(data as TaskComment | null, 'Actualizar comentario');
}

export async function deleteTaskComment(id: string): Promise<void> {
  return deleteById('tarea_comments', id);
}

export async function fetchTaskActivity(tareaId: string): Promise<TaskActivity[]> {
  const client = requireClient();
  const { data, error } = await client
    .from('tarea_activity')
    .select('id, tarea_id, actor_id, actor_name, event_type, field_name, old_value, new_value, created_at')
    .eq('tarea_id', tareaId)
    .order('created_at', { ascending: true });
  throwOnError(error);
  return (data ?? []) as TaskActivity[];
}

function safeSearchTerm(value: string): string {
  return value.trim().replace(/[(),"%_]/g, ' ');
}

export const MY_TASKS_PAGE_SIZE = 100;

export async function fetchMyTasks(
  filters: Partial<MyTasksFilters> = {},
  offset = 0,
  limit = MY_TASKS_PAGE_SIZE,
): Promise<MyTask[]> {
  const client = requireClient();
  const resolved = { ...DEFAULT_MY_TASKS_FILTERS, ...filters };
  let query = client.from('mis_tareas').select(
    'id, proyecto_id, title, description, status, priority, assignee_id, start_date, due_date, sort_order, created_by, created_at, updated_at, proyecto_name, espacio_id, espacio_name, status_name, status_is_done',
  );

  const search = safeSearchTerm(resolved.search);
  if (search) query = query.or(`title.ilike.%${search}%,description.ilike.%${search}%`);
  if (resolved.priority !== 'all') query = query.eq('priority', resolved.priority);
  if (resolved.completion !== 'all') query = query.eq('status_is_done', resolved.completion === 'completed');
  if (resolved.espacioId !== 'all') query = query.eq('espacio_id', resolved.espacioId);
  if (resolved.proyectoId !== 'all') query = query.eq('proyecto_id', resolved.proyectoId);

  const { data, error } = await query
    .order('due_date', { ascending: true, nullsFirst: false })
    .order('updated_at', { ascending: false })
    .order('id', { ascending: true })
    .range(offset, offset + limit - 1);
  throwOnError(error);
  return (data ?? []) as MyTask[];
}

export async function fetchMyTaskOrigins(): Promise<MyTaskOrigin[]> {
  const client = requireClient();
  const { data, error } = await client
    .from('mis_tareas_origenes')
    .select('proyecto_id, proyecto_name, espacio_id, espacio_name')
    .order('espacio_name', { ascending: true })
    .order('proyecto_name', { ascending: true });
  throwOnError(error);
  return (data ?? []) as MyTaskOrigin[];
}

export async function fetchTeamMembers(): Promise<TeamMember[]> {
  const client = requireClient();
  const { data, error } = await client.rpc('team_list_members');
  throwOnError(error);
  return data ?? [];
}

export async function fetchBoardColumns(proyectoId: string): Promise<BoardColumn[]> {
  const client = requireClient();
  const { data, error } = await client
    .from('board_columns')
    .select('*')
    .eq('proyecto_id', proyectoId)
    .order('sort_order')
    .order('created_at');
  throwOnError(error);
  const rows = (data ?? []) as BoardColumn[];
  if (rows.length === 0) {
    const { error: seedError } = await client.rpc('seed_default_board_columns', {
      p_proyecto_id: proyectoId,
    });
    if (seedError) {
      return fallbackBoardColumns(proyectoId);
    }
    const second = await client
      .from('board_columns')
      .select('*')
      .eq('proyecto_id', proyectoId)
      .order('sort_order')
      .order('created_at');
    throwOnError(second.error);
    const seeded = (second.data ?? []) as BoardColumn[];
    return seeded.length > 0 ? seeded : fallbackBoardColumns(proyectoId);
  }
  return rows;
}

export async function createBoardColumn(
  proyectoId: string,
  input: BoardColumnInput,
  existing: BoardColumn[],
): Promise<BoardColumn> {
  const client = requireClient();
  const key = uniqueColumnKey(
    input.name,
    new Set(existing.map((c) => c.key)),
  );
  const color = input.color ?? nextColumnColor(existing);
  const sort_order = nextColumnSortOrder(existing);
  const { data, error } = await client
    .from('board_columns')
    .insert({
      proyecto_id: proyectoId,
      key,
      name: input.name.trim(),
      color,
      sort_order,
      is_done: input.is_done ?? false,
      is_system: false,
    })
    .select('*')
    .single();
  throwOnError(error);
  return requireData(data, 'Crear columna del tablero');
}

export async function updateBoardColumn(
  id: string,
  patch: Partial<Pick<BoardColumn, 'name' | 'color' | 'sort_order' | 'is_done'>>,
): Promise<BoardColumn> {
  const client = requireClient();
  const { data, error } = await client
    .from('board_columns')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single();
  throwOnError(error);
  return requireData(data, 'Actualizar columna del tablero');
}

export async function deleteBoardColumn(id: string): Promise<void> {
  return deleteById('board_columns', id);
}
