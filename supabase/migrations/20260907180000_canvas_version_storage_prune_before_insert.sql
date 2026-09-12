CREATE OR REPLACE FUNCTION private.canvas_prune_document_versions(
  p_document_id uuid,
  p_keep integer DEFAULT 50
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_deleted integer;
BEGIN
  PERFORM 1
    FROM public.canvas_documents
   WHERE id = p_document_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  DELETE FROM public.canvas_document_versions AS version_row
   WHERE version_row.document_id = p_document_id
     AND (
       version_row.created_at < now() - interval '90 days'
       OR version_row.id IN (
         SELECT retained.id
           FROM public.canvas_document_versions AS retained
          WHERE retained.document_id = p_document_id
          ORDER BY retained.created_at DESC, retained.id DESC
          OFFSET GREATEST(p_keep, 0)
       )
     );

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

CREATE OR REPLACE FUNCTION private.canvas_record_document_version(
  p_document_id uuid,
  p_document jsonb,
  p_created_by uuid,
  p_created_at timestamptz
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_id uuid;
  v_created_at timestamptz;
BEGIN
  IF p_document_id IS NULL THEN
    RAISE EXCEPTION 'El documento Canvas requiere un id';
  END IF;

  PERFORM private.canvas_assert_document_within_limit(p_document);

  PERFORM 1
    FROM public.canvas_documents
   WHERE id = p_document_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No existe el documento Canvas %', p_document_id
      USING ERRCODE = '23503';
  END IF;

  v_created_at := COALESCE(p_created_at, now());

  PERFORM private.canvas_prune_document_versions(p_document_id, 49);

  INSERT INTO public.canvas_document_versions (
    document_id,
    document,
    created_by,
    created_at
  )
  VALUES (
    p_document_id,
    p_document,
    p_created_by,
    v_created_at
  )
  RETURNING id INTO v_id;

  PERFORM private.canvas_prune_document_versions(p_document_id, 50);

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION private.canvas_prune_document_versions(uuid, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.canvas_record_document_version(uuid, jsonb, uuid, timestamptz)
  FROM PUBLIC, anon, authenticated;
