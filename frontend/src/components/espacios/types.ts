/** Free-form status key matching board_columns.key (defaults: todo, in_progress, …). */
export type TareaStatus = string;

export type VistaType = 'list' | 'board' | 'table' | 'calendar' | 'gantt';

export interface Espacio {
  id: string;
  name: string;
  color: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Proyecto {
  id: string;
  espacio_id: string;
  name: string;
  color: string | null;
  is_favorite: boolean;
  created_at: string;
  updated_at: string;
}

export interface BoardColumn {
  id: string;
  proyecto_id: string;
  key: string;
  name: string;
  color: string;
  sort_order: number;
  is_done: boolean;
  is_system: boolean;
  created_at: string;
  updated_at: string;
}

export interface BoardColumnInput {
  name: string;
  color?: string;
  is_done?: boolean;
}

export interface Tarea {
  id: string;
  proyecto_id: string;
  title: string;
  description: string | null;
  status: TareaStatus;
  assignee_id: string | null;
  start_date: string | null;
  due_date: string | null;
  sort_order: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface TeamMember {
  user_id: string;
  display_name: string;
  email: string;
}

export interface TareaInput {
  title: string;
  description?: string | null;
  status?: TareaStatus;
  assignee_id?: string | null;
  start_date?: string | null;
  due_date?: string | null;
  sort_order?: number;
}

export interface TareaFilters {
  search: string;
  status: TareaStatus | 'all';
  assigneeId: string | 'all';
  showClosed: boolean;
}

export const DEFAULT_FILTERS: TareaFilters = {
  search: '',
  status: 'all',
  assigneeId: 'all',
  showClosed: false,
};
