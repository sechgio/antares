import { useCallback } from 'react';
import { toLocalDateString } from '../utils/dates';

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
