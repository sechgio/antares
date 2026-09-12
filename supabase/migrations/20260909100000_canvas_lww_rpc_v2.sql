-- Historical rows are checked incrementally by an operator instead of during
-- deployment. The UUID cursors let callers walk indexed primary keys without
-- rescanning rows that were already inspected.
CREATE OR REPLACE FUNCTION public.canvas_validate_legacy_storage_batch(
  p_document_after uuid DEFAULT NULL,
  p_version_after uuid DEFAULT NULL,
  p_limit integer DEFAULT 100
)
RETURNS TABLE (
  table_name text,
  row_id uuid,
  payload_bytes bigint,
  exceeds_limit boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, pg_temp
AS $$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 100), 1), 1000);
BEGIN
  IF COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Sólo service_role puede validar el almacenamiento Canvas';
  END IF;

  RETURN QUERY
  WITH batch AS MATERIALIZED (
    SELECT
      document_row.id,
      private.canvas_payload_bytes(document_row.document) AS payload_bytes
      FROM public.canvas_documents AS document_row
     WHERE p_document_after IS NULL OR document_row.id > p_document_after
     ORDER BY document_row.id
     LIMIT v_limit
  )
  SELECT
    'canvas_documents'::text,
    batch.id,
    batch.payload_bytes,
    batch.payload_bytes > 16777216
    FROM batch;

  RETURN QUERY
  WITH batch AS MATERIALIZED (
    SELECT
      version_row.id,
      private.canvas_payload_bytes(version_row.document) AS payload_bytes
      FROM public.canvas_document_versions AS version_row
     WHERE p_version_after IS NULL OR version_row.id > p_version_after
     ORDER BY version_row.id
     LIMIT v_limit
  )
  SELECT
    'canvas_document_versions'::text,
    batch.id,
    batch.payload_bytes,
    batch.payload_bytes > 16777216
    FROM batch;
END;
$$;

REVOKE ALL ON FUNCTION public.canvas_validate_legacy_storage_batch(uuid, uuid, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.canvas_validate_legacy_storage_batch(uuid, uuid, integer)
  TO service_role;

DROP FUNCTION IF EXISTS public.canvas_push_document_lww(
  uuid,
  text,
  jsonb,
  timestamptz,
  boolean
);

CREATE OR REPLACE FUNCTION private.canvas_push_document_lww_v2(
  p_document jsonb,
  p_updated_at timestamptz DEFAULT NULL,
  p_force_resurrect boolean DEFAULT false
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, pg_temp
AS $$
DECLARE
  v_uid uuid;
  v_id uuid;
  v_name text;
  v_updated_at timestamptz;
  v_content_hash text;
  v_existing public.canvas_documents%ROWTYPE;
  v_existing_hash text;
BEGIN
  IF NOT private.is_active_user() THEN
    RAISE EXCEPTION 'Usuario no autorizado';
  END IF;

  IF p_document IS NULL
     OR jsonb_typeof(p_document) <> 'object'
     OR p_document->>'id' IS NULL THEN
    RAISE EXCEPTION 'Documento Canvas inválido';
  END IF;

  PERFORM private.canvas_assert_document_within_limit(p_document);
  v_uid := auth.uid();
  v_id := (p_document->>'id')::uuid;
  v_name := COALESCE(NULLIF(p_document->>'name', ''), 'Sin título');
  v_updated_at := COALESCE(
    p_updated_at,
    NULLIF(p_document->>'updatedAt', '')::timestamptz,
    now()
  );

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_id::text, 0));
  PERFORM private.canvas_purge_deleted_documents(25);

  SELECT *
    INTO v_existing
    FROM public.canvas_documents
   WHERE id = v_id
   FOR UPDATE;

  IF FOUND THEN
    IF NOT p_force_resurrect
       AND (
         v_existing.deleted_at IS NOT NULL
         OR v_updated_at < v_existing.updated_at
       ) THEN
      PERFORM private.canvas_record_document_version(
        v_id,
        p_document,
        v_uid,
        v_updated_at
      );
      RETURN false;
    END IF;

    IF v_existing.deleted_at IS NULL
       AND v_existing.updated_at = v_updated_at THEN
      v_content_hash := private.canvas_document_hash(p_document);
      v_existing_hash := COALESCE(
        v_existing.content_hash,
        private.canvas_document_hash(v_existing.document)
      );
      IF v_existing_hash = v_content_hash THEN
        RETURN true;
      END IF;
    END IF;

    UPDATE public.canvas_documents
       SET name = v_name,
           document = p_document,
           updated_by = v_uid,
           updated_at = v_updated_at,
           deleted_at = NULL
     WHERE id = v_id;
    RETURN true;
  END IF;

  INSERT INTO public.canvas_documents (
    id,
    name,
    document,
    created_by,
    updated_by,
    updated_at
  )
  VALUES (
    v_id,
    v_name,
    p_document,
    v_uid,
    v_uid,
    v_updated_at
  );
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION private.canvas_push_document_lww_v2(jsonb, timestamptz, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.canvas_push_document_lww_v2(jsonb, timestamptz, boolean)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.canvas_push_document_lww_v2(
  p_document jsonb,
  p_updated_at timestamptz DEFAULT NULL,
  p_force_resurrect boolean DEFAULT false
)
RETURNS boolean
LANGUAGE sql
SECURITY INVOKER
SET search_path = public, private
AS $$
  SELECT private.canvas_push_document_lww_v2(p_document, p_updated_at, p_force_resurrect);
$$;

REVOKE ALL ON FUNCTION public.canvas_push_document_lww_v2(jsonb, timestamptz, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.canvas_push_document_lww_v2(jsonb, timestamptz, boolean)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION private.canvas_delete_document_lww_v2(
  p_id uuid,
  p_deleted_at timestamptz DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, pg_temp
AS $$
DECLARE
  v_existing public.canvas_documents%ROWTYPE;
  v_deleted_at timestamptz;
  v_uid uuid := auth.uid();
BEGIN
  IF NOT private.is_active_user() THEN
    RAISE EXCEPTION 'Usuario no autorizado';
  END IF;
  IF p_id IS NULL THEN
    RAISE EXCEPTION 'El documento Canvas requiere un id';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_id::text, 0));

  SELECT *
    INTO v_existing
    FROM public.canvas_documents
   WHERE id = p_id
   FOR UPDATE;

  IF NOT FOUND OR v_existing.deleted_at IS NOT NULL THEN
    RETURN FOUND;
  END IF;

  v_deleted_at := GREATEST(COALESCE(p_deleted_at, clock_timestamp()), v_existing.updated_at);
  UPDATE public.canvas_documents
     SET deleted_at = v_deleted_at,
         updated_at = v_deleted_at,
         updated_by = v_uid
   WHERE id = p_id;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION private.canvas_delete_document_lww_v2(uuid, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.canvas_delete_document_lww_v2(uuid, timestamptz)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.canvas_delete_document_lww_v2(
  p_id uuid,
  p_deleted_at timestamptz DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql
SECURITY INVOKER
SET search_path = public, private
AS $$
  SELECT private.canvas_delete_document_lww_v2(p_id, p_deleted_at);
$$;

REVOKE ALL ON FUNCTION public.canvas_delete_document_lww_v2(uuid, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.canvas_delete_document_lww_v2(uuid, timestamptz)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION private.canvas_push_document_lww(
  p_document jsonb,
  p_updated_at timestamptz DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, pg_temp
AS $$
DECLARE
  v_uid uuid;
  v_id uuid;
  v_name text;
  v_updated_at timestamptz;
  v_existing public.canvas_documents%ROWTYPE;
  v_content_hash text;
  v_existing_hash text;
BEGIN
  IF NOT private.is_active_user() THEN
    RAISE EXCEPTION 'Usuario no autorizado';
  END IF;

  PERFORM private.canvas_assert_document_within_limit(p_document);
  IF p_document->>'id' IS NULL THEN
    RAISE EXCEPTION 'El documento Canvas requiere un id';
  END IF;

  v_uid := auth.uid();
  v_id := (p_document->>'id')::uuid;
  v_name := COALESCE(NULLIF(p_document->>'name', ''), 'Sin título');
  v_updated_at := COALESCE(
    p_updated_at,
    NULLIF(p_document->>'updatedAt', '')::timestamptz,
    now()
  );

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_id::text, 0));
  PERFORM private.canvas_purge_deleted_documents(25);

  SELECT *
    INTO v_existing
    FROM public.canvas_documents
   WHERE id = v_id
   FOR UPDATE;

  IF FOUND THEN
    IF v_updated_at < v_existing.updated_at THEN
      -- Preserve stale writes in public.canvas_document_versions through the
      -- canonical version recorder instead of overwriting the live row.
      PERFORM private.canvas_record_document_version(
        v_id,
        p_document,
        v_uid,
        v_updated_at
      );
      RETURN false;
    END IF;

    IF v_existing.deleted_at IS NULL
       AND v_existing.updated_at = v_updated_at THEN
      v_content_hash := private.canvas_document_hash(p_document);
      v_existing_hash := COALESCE(
        v_existing.content_hash,
        private.canvas_document_hash(v_existing.document)
      );
      IF v_existing_hash = v_content_hash THEN
        RETURN true;
      END IF;
    END IF;

    UPDATE public.canvas_documents
       SET name = v_name,
           document = p_document,
           updated_by = v_uid,
           updated_at = v_updated_at,
           deleted_at = NULL
     WHERE id = v_id;
    RETURN true;
  END IF;

  INSERT INTO public.canvas_documents (
    id,
    name,
    document,
    created_by,
    updated_by,
    updated_at
  )
  VALUES (
    v_id,
    v_name,
    p_document,
    v_uid,
    v_uid,
    v_updated_at
  );
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION private.canvas_push_document_lww(jsonb, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.canvas_push_document_lww(jsonb, timestamptz)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.canvas_push_document_lww(
  p_document jsonb,
  p_updated_at timestamptz DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql
SECURITY INVOKER
SET search_path = public, private
AS $$
  SELECT private.canvas_push_document_lww(p_document, p_updated_at);
$$;

REVOKE ALL ON FUNCTION public.canvas_push_document_lww(jsonb, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.canvas_push_document_lww(jsonb, timestamptz)
  TO authenticated, service_role;
