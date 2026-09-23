-- Register the already-shipped T01 contract in migration history. This must
-- precede T03/T04 because the global view projects tareas.priority.
ALTER TABLE public.tareas ADD COLUMN IF NOT EXISTS priority text;

UPDATE public.tareas
SET priority = CASE WHEN status = 'urgent' THEN 'urgent' ELSE 'normal' END
WHERE priority IS NULL;

DO $$
BEGIN
  ALTER TABLE public.tareas ALTER COLUMN priority SET DEFAULT 'normal';
  ALTER TABLE public.tareas ALTER COLUMN priority SET NOT NULL;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tareas_priority_check'
  ) THEN
    ALTER TABLE public.tareas ADD CONSTRAINT tareas_priority_check
      CHECK (priority IN ('low', 'normal', 'high', 'urgent'));
  END IF;
END $$;

COMMENT ON COLUMN public.tareas.priority IS
  'Independent task priority. Legacy urgent statuses are preserved; changing priority never changes status.';
