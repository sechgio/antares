-- Canvas document versions: append-only version history table & snapshot trigger.
-- Stores prior versions upon document UPDATE, limits retention to 50 versions per doc,
-- and performs retroactive seeding for existing active documents.

CREATE TABLE IF NOT EXISTS public.canvas_document_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.canvas_documents(id) ON DELETE CASCADE,
  document jsonb NOT NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_canvas_doc_versions_doc_date
  ON public.canvas_document_versions (document_id, created_at DESC);

ALTER TABLE public.canvas_document_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "canvas_doc_versions_active_users_select" ON public.canvas_document_versions;
CREATE POLICY "canvas_doc_versions_active_users_select"
  ON public.canvas_document_versions
  FOR SELECT
  TO authenticated
  USING (public.is_active_user());

DROP POLICY IF EXISTS "canvas_doc_versions_active_users_insert" ON public.canvas_document_versions;
CREATE POLICY "canvas_doc_versions_active_users_insert"
  ON public.canvas_document_versions
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_active_user());

GRANT SELECT, INSERT ON public.canvas_document_versions TO authenticated;
GRANT ALL ON public.canvas_document_versions TO service_role;

-- Snapshot function & trigger (SECURITY DEFINER allows pruning past versions bypassing client RLS)
CREATE OR REPLACE FUNCTION public.canvas_documents_snapshot_and_prune()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Save snapshot of previous document version
  INSERT INTO public.canvas_document_versions (document_id, document, created_by, created_at)
  VALUES (OLD.id, OLD.document, OLD.updated_by, OLD.updated_at);

  -- Keep maximum 50 versions per document
  DELETE FROM public.canvas_document_versions
  WHERE id IN (
    SELECT id FROM public.canvas_document_versions
    WHERE document_id = OLD.id
    ORDER BY created_at DESC
    OFFSET 50
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS canvas_documents_snapshot_trigger ON public.canvas_documents;
CREATE TRIGGER canvas_documents_snapshot_trigger
  BEFORE UPDATE ON public.canvas_documents
  FOR EACH ROW EXECUTE FUNCTION public.canvas_documents_snapshot_and_prune();

-- Seeding / Backfill: create initial version 1 for all active documents
INSERT INTO public.canvas_document_versions (id, document_id, document, created_by, created_at)
SELECT id, id, document, created_by, updated_at
FROM public.canvas_documents
WHERE deleted_at IS NULL
ON CONFLICT (id) DO NOTHING;
