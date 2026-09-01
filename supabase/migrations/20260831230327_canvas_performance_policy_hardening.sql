-- Add indexes for foreign keys used by ownership and cascading deletes.
CREATE INDEX IF NOT EXISTS idx_canvas_documents_created_by
  ON public.canvas_documents (created_by)
  WHERE created_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_canvas_documents_updated_by
  ON public.canvas_documents (updated_by)
  WHERE updated_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_canvas_document_versions_created_by
  ON public.canvas_document_versions (created_by)
  WHERE created_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_espacios_created_by
  ON public.espacios (created_by)
  WHERE created_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tareas_created_by
  ON public.tareas (created_by)
  WHERE created_by IS NOT NULL;

-- Keep the admin profile policy scoped to authenticated callers.
DROP POLICY IF EXISTS "admins_read_all_profiles" ON public.user_profiles;
CREATE POLICY "admins_read_all_profiles"
  ON public.user_profiles
  FOR SELECT
  TO authenticated
  USING ((SELECT public.is_admin()));
