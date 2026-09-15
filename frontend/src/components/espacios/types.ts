export type TareaStatus = string;
export type TareaPriority = 'low' | 'normal' | 'high' | 'urgent';

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
  // Optional only for snapshots from clients predating the priority migration.
  priority?: TareaPriority;
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
}

export interface TareaInput {
  title: string;
  description?: string | null;
  status?: TareaStatus;
  priority?: TareaPriority;
  assignee_id?: string | null;
  start_date?: string | null;
  due_date?: string | null;
  sort_order?: number;
}

export interface TareaFilters {
  search: string;
  status: TareaStatus | 'all';
  priority?: TareaPriority | 'all';
  assigneeId: string | 'all';
  showClosed: boolean;
}

export const DEFAULT_FILTERS: TareaFilters = {
  search: '',
  status: 'all',
  priority: 'all',
  assigneeId: 'all',
  showClosed: false,
};
