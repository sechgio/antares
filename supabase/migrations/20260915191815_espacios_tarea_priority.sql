-- Register the already-shipped T01 contract in migration history. This must
-- precede T03/T04 because the global view projects tareas.priority.
ALTER TABLE public.tareas ADD COLUMN priority text;

UPDATE public.tareas
SET priority = CASE WHEN status = 'urgent' THEN 'urgent' ELSE 'normal' END;

ALTER TABLE public.tareas
  ALTER COLUMN priority SET DEFAULT 'normal',
  ALTER COLUMN priority SET NOT NULL,
  ADD CONSTRAINT tareas_priority_check
    CHECK (priority IN ('low', 'normal', 'high', 'urgent'));

COMMENT ON COLUMN public.tareas.priority IS
  'Independent task priority. Legacy urgent statuses are preserved; changing priority never changes status.';
