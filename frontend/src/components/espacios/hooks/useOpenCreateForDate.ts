import { useCallback } from 'react';
import { toLocalDateString } from '../utils/dates';

// Regla compartida Gantt/Calendar: click en fecha abre creación con esa fecha;
// sin handler de fecha cae a la creación genérica.
export function useOpenCreateForDate(
  onAddTask?: () => void,
  onAddTaskOnDate?: (date: string) => void,
) {
  return useCallback(
    (date: string | Date) => {
      if (onAddTaskOnDate) {
        onAddTaskOnDate(typeof date === 'string' ? date : toLocalDateString(date));
        return;
      }
      onAddTask?.();
    },
    [onAddTask, onAddTaskOnDate],
  );
}
