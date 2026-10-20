
ALTER TABLE public.tareas DROP CONSTRAINT IF EXISTS tareas_status_check;

ALTER TABLE public.tareas
  ADD CONSTRAINT tareas_status_check
  CHECK (status IN ('todo', 'in_progress', 'done', 'urgent', 'closed'));
