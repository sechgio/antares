-- Enforce Last-Write-Wins (LWW) atomicity on canvas_documents.
-- Prevents delayed client updates with older timestamps from silently overwriting newer ones,
-- while safely preserving any out-of-order document versions in canvas_document_versions.

-- Trigger function: runs before UPDATE on canvas_documents
CREATE OR REPLACE FUNCTION public.canvas_documents_enforce_lww()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- If the incoming updated_at is older than the existing row in the DB:
  IF OLD.updated_at IS NOT NULL AND NEW.updated_at IS NOT NULL AND NEW.updated_at < OLD.updated_at THEN
    -- Archive the incoming older document to canvas_document_versions so no work is lost
    INSERT INTO public.canvas_document_versions (document_id, document, created_by, created_at)
    VALUES (NEW.id, NEW.document, NEW.updated_by, NEW.updated_at);

    -- Suppress the update on canvas_documents to protect the newer document
    RETURN NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS canvas_documents_lww_trigger ON public.canvas_documents;
CREATE TRIGGER canvas_documents_lww_trigger
  BEFORE UPDATE ON public.canvas_documents
  FOR EACH ROW
  EXECUTE FUNCTION public.canvas_documents_enforce_lww();

-- Atomic RPC function for pushing canvas documents with LWW enforcement
CREATE OR REPLACE FUNCTION public.canvas_push_document_lww(p_document jsonb, p_updated_at timestamptz DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id uuid := (p_document->>'id')::uuid;
  v_name text := coalesce(p_document->>'name', 'Sin título');
  v_updated_at timestamptz := coalesce(p_updated_at, (p_document->>'updatedAt')::timestamptz, now());
  v_existing record;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  -- Lock the target row if it exists to serialize concurrent pushes for the same document
  SELECT updated_at, deleted_at, created_by INTO v_existing
  FROM public.canvas_documents
  WHERE id = v_id
  FOR UPDATE;

  IF FOUND THEN
    -- If existing row is newer, record the version and skip overwriting main row
    IF v_existing.updated_at IS NOT NULL AND v_updated_at < v_existing.updated_at THEN
      INSERT INTO public.canvas_document_versions (document_id, document, created_by, created_at)
      VALUES (v_id, p_document, v_uid, v_updated_at);
      RETURN false;
    END IF;

    -- Otherwise update the document
    UPDATE public.canvas_documents
    SET
      name = v_name,
      document = p_document,
      updated_at = v_updated_at,
      updated_by = v_uid,
      deleted_at = NULL
    WHERE id = v_id;
    RETURN true;
  ELSE
    -- Insert new document
    INSERT INTO public.canvas_documents (id, name, document, updated_at, updated_by, created_by, deleted_at)
    VALUES (v_id, v_name, p_document, v_updated_at, v_uid, v_uid, NULL);
    RETURN true;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.canvas_push_document_lww(jsonb, timestamptz) TO authenticated;
