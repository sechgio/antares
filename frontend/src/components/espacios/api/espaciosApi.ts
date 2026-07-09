import { supabase } from '../../../lib/supabase';
import type {
  BoardColumn,
  BoardColumnInput,
  Espacio,
  Proyecto,
  Tarea,
  TareaInput,
  TeamMember,
} from '../types';
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

/** Supabase returns plain { message, code, ... } objects, not Error instances. */
function throwOnError(error: { message?: string; code?: string } | null): void {
  if (!error) return;
  const code = error.code ? ` [${error.code}]` : '';
  throw new Error((error.message || 'Error de Supabase') + code);
}

function requireData<T>(data: T | null, action: string): T {
  if (data == null) throw new Error(`${action}: respuesta vacía de Supabase`);
  return data;
}

export async function fetchEspacios(): Promise<Espacio[]> {
  const client = requireClient();
  const { data, error } = await client.from('espacios').select('*').order('name');
  throwOnError(error);
  return data ?? [];
}

export async function deleteEspacio(id: string): Promise<void> {
  const client = requireClient();
  const { error } = await client.from('espacios').delete().eq('id', id);
  throwOnError(error);
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
  const client = requireClient();
  const { error } = await client.from('proyectos').delete().eq('id', id);
  throwOnError(error);
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
    .select('*')
    .eq('proyecto_id', proyectoId)
    .order('sort_order')
    .order('created_at');
  throwOnError(error);
  return data ?? [];
}

/** Open tasks with due_date on/before horizon (for titlebar due notifications). */
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

  // Drop tasks whose status is a done-like board column (including custom is_done keys).
  const proyectoIds = [...new Set(rows.map((r) => r.proyecto_id))];
  if (proyectoIds.length === 0) return rows;

  const { data: doneCols, error: doneColsError } = await client
    .from('board_columns')
    .select('proyecto_id, key')
    .in('proyecto_id', proyectoIds)
    .eq('is_done', true);

  if (doneColsError || !doneCols) {
    // Pre-migration / offline: fall back to builtin done/closed only.
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
  const client = requireClient();
  const { data, error } = await client
    .from('tareas')
    .insert({
      proyecto_id: proyectoId,
      title: input.title,
      description: input.description ?? null,
      status: input.status ?? 'todo',
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
  const client = requireClient();
  const { data, error } = await client.from('tareas').update(patch).eq('id', id).select('*').single();
  throwOnError(error);
  return requireData(data, 'Actualizar tarea');
}

export async function deleteTarea(id: string): Promise<void> {
  const client = requireClient();
  const { error } = await client.from('tareas').delete().eq('id', id);
  throwOnError(error);
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
    // Migration not applied yet or seed lag: ensure defaults server-side, then re-fetch.
    const { error: seedError } = await client.rpc('seed_default_board_columns', {
      p_proyecto_id: proyectoId,
    });
    if (seedError) {
      // Offline / pre-migration: local defaults so the board still works.
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
  const client = requireClient();
  const { error } = await client.from('board_columns').delete().eq('id', id);
  throwOnError(error);
}
