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

export interface TaskComment {
  id: string;
  tarea_id: string;
  author_id: string | null;
  author_name: string;
  body: string;
  created_at: string;
  updated_at: string;
}

export type TaskActivityEventType = 'task_created' | 'field_changed' | 'comment_created';
export type TaskActivityFieldName =
  | 'title'
  | 'description'
  | 'status'
  | 'priority'
  | 'assignee_id'
  | 'start_date'
  | 'due_date';

export interface TaskActivity {
  id: string;
  tarea_id: string;
  actor_id: string | null;
  actor_name: string | null;
  event_type: TaskActivityEventType;
  field_name: TaskActivityFieldName | null;
  old_value: unknown;
  new_value: unknown;
  created_at: string;
}

export interface MyTask extends Tarea {
  proyecto_name: string;
  espacio_id: string;
  espacio_name: string;
  status_name: string;
  status_is_done: boolean;
}

export interface MyTaskOrigin {
  proyecto_id: string;
  proyecto_name: string;
  espacio_id: string;
  espacio_name: string;
}

export type MyTasksCompletionFilter = 'open' | 'completed' | 'all';

export interface MyTasksFilters {
  search: string;
  priority: TareaPriority | 'all';
  completion: MyTasksCompletionFilter;
  espacioId: string | 'all';
  proyectoId: string | 'all';
}

export const DEFAULT_MY_TASKS_FILTERS: MyTasksFilters = {
  search: '',
  priority: 'all',
  completion: 'open',
  espacioId: 'all',
  proyectoId: 'all',
};

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
