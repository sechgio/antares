-- Canvas templates: shared library for all active authenticated users.
-- Local app keeps a file cache; this table is the multi-user source of truth.

CREATE TABLE IF NOT EXISTS public.canvas_documents (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  document jsonb NOT NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_canvas_documents_updated_at
  ON public.canvas_documents (updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_canvas_documents_deleted_at
  ON public.canvas_documents (deleted_at)
  WHERE deleted_at IS NULL;

ALTER TABLE public.canvas_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "canvas_documents_active_users_all" ON public.canvas_documents;
CREATE POLICY "canvas_documents_active_users_all"
  ON public.canvas_documents
  FOR ALL
  TO authenticated
  USING (public.is_active_user())
  WITH CHECK (public.is_active_user());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.canvas_documents TO authenticated;
GRANT ALL ON public.canvas_documents TO service_role;
