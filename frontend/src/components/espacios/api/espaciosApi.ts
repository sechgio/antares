import { supabase } from '../../../lib/supabase';
import type { Espacio, Proyecto, Tarea, TareaInput, TeamMember } from '../types';

function requireClient() {
  if (!supabase) throw new Error('Supabase no configurado');
  return supabase;
}

export async function fetchEspacios(): Promise<Espacio[]> {
  const client = requireClient();
  const { data, error } = await client.from('espacios').select('*').order('name');
  if (error) throw error;
  return data ?? [];
}

export async function deleteEspacio(id: string): Promise<void> {
  const client = requireClient();
  const { error } = await client.from('espacios').delete().eq('id', id);
  if (error) throw error;
}

export async function createEspacio(name: string, userId: string, color?: string): Promise<Espacio> {
  const client = requireClient();
  const { data, error } = await client
    .from('espacios')
    .insert({ name, created_by: userId, color: color ?? null })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

export async function updateEspacio(
  id: string,
  patch: Partial<Pick<Espacio, 'name' | 'color'>>,
): Promise<Espacio> {
  const client = requireClient();
  const { data, error } = await client.from('espacios').update(patch).eq('id', id).select('*').single();
  if (error) throw error;
  return data;
}

export async function fetchProyectos(espacioId: string): Promise<Proyecto[]> {
  const client = requireClient();
  const { data, error } = await client
    .from('proyectos')
    .select('*')
    .eq('espacio_id', espacioId)
    .order('name');
  if (error) throw error;
  return data ?? [];
}

export async function createProyecto(espacioId: string, name: string, color?: string): Promise<Proyecto> {
  const client = requireClient();
  const { data, error } = await client
    .from('proyectos')
    .insert({ espacio_id: espacioId, name, color: color ?? null })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

export async function deleteProyecto(id: string): Promise<void> {
  const client = requireClient();
  const { error } = await client.from('proyectos').delete().eq('id', id);
  if (error) throw error;
}

export async function updateProyecto(
  id: string,
  patch: Partial<Pick<Proyecto, 'name' | 'color' | 'is_favorite'>>,
): Promise<Proyecto> {
  const client = requireClient();
  const { data, error } = await client.from('proyectos').update(patch).eq('id', id).select('*').single();
  if (error) throw error;
  return data;
}

export async function fetchTareas(proyectoId: string): Promise<Tarea[]> {
  const client = requireClient();
  const { data, error } = await client
    .from('tareas')
    .select('*')
    .eq('proyecto_id', proyectoId)
    .order('sort_order')
    .order('created_at');
  if (error) throw error;
  return data ?? [];
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
  if (error) throw error;
  return data;
}

export async function updateTarea(id: string, patch: Partial<TareaInput & Pick<Tarea, 'status'>>): Promise<Tarea> {
  const client = requireClient();
  const { data, error } = await client.from('tareas').update(patch).eq('id', id).select('*').single();
  if (error) throw error;
  return data;
}

export async function deleteTarea(id: string): Promise<void> {
  const client = requireClient();
  const { error } = await client.from('tareas').delete().eq('id', id);
  if (error) throw error;
}

export async function fetchTeamMembers(): Promise<TeamMember[]> {
  const client = requireClient();
  const { data, error } = await client.rpc('team_list_members');
  if (error) throw error;
  return data ?? [];
}
