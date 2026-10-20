
CREATE OR REPLACE FUNCTION public.canvas_documents_enforce_lww()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF OLD.updated_at IS NOT NULL AND NEW.updated_at IS NOT NULL AND NEW.updated_at < OLD.updated_at THEN
    INSERT INTO public.canvas_document_versions (document_id, document, created_by, created_at)
    VALUES (NEW.id, NEW.document, NEW.updated_by, NEW.updated_at);

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

  SELECT updated_at, deleted_at, created_by INTO v_existing
  FROM public.canvas_documents
  WHERE id = v_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.updated_at IS NOT NULL AND v_updated_at < v_existing.updated_at THEN
      INSERT INTO public.canvas_document_versions (document_id, document, created_by, created_at)
      VALUES (v_id, p_document, v_uid, v_updated_at);
      RETURN false;
    END IF;

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
    INSERT INTO public.canvas_documents (id, name, document, updated_at, updated_by, created_by, deleted_at)
    VALUES (v_id, v_name, p_document, v_updated_at, v_uid, v_uid, NULL);
    RETURN true;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.canvas_push_document_lww(jsonb, timestamptz) TO authenticated;
