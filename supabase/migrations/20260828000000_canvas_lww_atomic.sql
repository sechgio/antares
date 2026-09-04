-- Migration: Atomic LWW push and delete for canvas_documents to eliminate TOCTOU races.
-- Prevents concurrent overwrite when another client pushed or deleted a newer version.

CREATE OR REPLACE FUNCTION public.canvas_push_document_lww(
  p_id uuid,
  p_name text,
  p_document jsonb,
  p_updated_at timestamptz,
  p_force_resurrect boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing RECORD;
  v_uid uuid := auth.uid();
BEGIN
  IF NOT public.is_active_user() THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  -- Lock by document id even when the row does not exist yet. FOR UPDATE
  -- alone cannot lock a missing row, so two first-time inserts could race.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_id::text, 0));

  -- Serialize concurrent mutations for this document id.
  SELECT updated_at, deleted_at, created_by INTO v_existing
  FROM public.canvas_documents
  WHERE id = p_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.deleted_at IS NOT NULL AND NOT p_force_resurrect THEN
      PERFORM public.canvas_append_document_version(p_id, p_document);
      RETURN jsonb_build_object(
        'applied', false,
        'reason', 'remote_deleted',
        'remote_updated_at', v_existing.updated_at,
        'remote_deleted_at', v_existing.deleted_at
      );
    END IF;

    IF v_existing.updated_at > p_updated_at AND NOT p_force_resurrect THEN
      PERFORM public.canvas_append_document_version(p_id, p_document);
      RETURN jsonb_build_object(
        'applied', false,
        'reason', 'remote_newer',
        'remote_updated_at', v_existing.updated_at
      );
    END IF;

    UPDATE public.canvas_documents
    SET name = p_name,
        document = p_document,
        updated_at = p_updated_at,
        updated_by = v_uid,
        deleted_at = NULL
    WHERE id = p_id;
  ELSE
    INSERT INTO public.canvas_documents (
      id,
      name,
      document,
      updated_at,
      updated_by,
      deleted_at,
      created_by
    )
    VALUES (
      p_id,
      p_name,
      p_document,
      p_updated_at,
      v_uid,
      NULL,
      v_uid
    );
  END IF;

  RETURN jsonb_build_object('applied', true);
END;
$$;

REVOKE ALL ON FUNCTION public.canvas_push_document_lww(uuid, text, jsonb, timestamptz, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.canvas_push_document_lww(uuid, text, jsonb, timestamptz, boolean) TO authenticated;

-- Only delete when the document has not advanced past the expected version.
CREATE OR REPLACE FUNCTION public.canvas_delete_document_lww(
  p_id uuid,
  p_expected_updated_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing RECORD;
  v_now timestamptz := clock_timestamp();
  v_uid uuid := auth.uid();
BEGIN
  IF NOT public.is_active_user() THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_id::text, 0));

  SELECT updated_at, deleted_at INTO v_existing
  FROM public.canvas_documents
  WHERE id = p_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'not_found');
  END IF;

  IF v_existing.deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object('applied', true, 'already_deleted', true);
  END IF;

  IF p_expected_updated_at IS NOT NULL AND v_existing.updated_at > p_expected_updated_at THEN
    RETURN jsonb_build_object(
      'applied', false,
      'reason', 'remote_newer',
      'remote_updated_at', v_existing.updated_at
    );
  END IF;

  UPDATE public.canvas_documents
  SET deleted_at = v_now,
      updated_at = v_now,
      updated_by = v_uid
  WHERE id = p_id;

  RETURN jsonb_build_object('applied', true);
END;
$$;

REVOKE ALL ON FUNCTION public.canvas_delete_document_lww(uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.canvas_delete_document_lww(uuid, timestamptz) TO authenticated;
