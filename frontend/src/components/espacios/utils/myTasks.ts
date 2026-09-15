import type { MyTask, MyTasksFilters } from '../types';
import { DEFAULT_MY_TASKS_FILTERS } from '../types';
import { addDaysToIsoDate } from './dates';

export type MyTasksGroupKey = 'overdue' | 'today' | 'week' | 'later' | 'undated' | 'completed';

export interface MyTasksGroup {
  key: MyTasksGroupKey;
  label: string;
  tasks: MyTask[];
}

const GROUP_LABELS: Record<MyTasksGroupKey, string> = {
  overdue: 'Atrasadas',
  today: 'Hoy',
  week: 'Esta semana',
  later: 'Más adelante',
  undated: 'Sin fecha',
  completed: 'Completadas',
};

function endOfWeek(today: string): string {
  const [year, month, day] = today.split('-').map(Number);
  const local = new Date(year, month - 1, day);
  const daysUntilSunday = (7 - local.getDay()) % 7;
  return addDaysToIsoDate(today, daysUntilSunday);
}

export function filterMyTasks(
  tasks: MyTask[],
  filters: MyTasksFilters = DEFAULT_MY_TASKS_FILTERS,
): MyTask[] {
  const search = filters.search.trim().toLocaleLowerCase('es');
  return tasks.filter((task) => {
    if (filters.completion === 'open' && task.status_is_done) return false;
    if (filters.completion === 'completed' && !task.status_is_done) return false;
    if (filters.priority !== 'all' && task.priority !== filters.priority) return false;
    if (filters.espacioId !== 'all' && task.espacio_id !== filters.espacioId) return false;
    if (filters.proyectoId !== 'all' && task.proyecto_id !== filters.proyectoId) return false;
    if (search && !`${task.title} ${task.description ?? ''}`.toLocaleLowerCase('es').includes(search)) return false;
    return true;
  });
}

export function groupMyTasks(tasks: MyTask[], today: string): MyTasksGroup[] {
  const weekEnd = endOfWeek(today);
  const grouped: Record<MyTasksGroupKey, MyTask[]> = {
    overdue: [], today: [], week: [], later: [], undated: [], completed: [],
  };

  for (const task of tasks) {
    if (task.status_is_done) {
      grouped.completed.push(task);
      continue;
    }
    if (!task.due_date) grouped.undated.push(task);
    else if (task.due_date < today) grouped.overdue.push(task);
    else if (task.due_date === today) grouped.today.push(task);
    else if (task.due_date <= weekEnd) grouped.week.push(task);
    else grouped.later.push(task);
  }

  const order: MyTasksGroupKey[] = ['overdue', 'today', 'week', 'later', 'undated'];
  if (grouped.completed.length > 0) order.push('completed');
  return order.map((key) => ({
    key,
    label: GROUP_LABELS[key],
    tasks: grouped[key].sort((a, b) => (a.due_date ?? '').localeCompare(b.due_date ?? '') || a.title.localeCompare(b.title)),
  }));
}
