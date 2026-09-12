ALTER TABLE public.canvas_documents
  ADD COLUMN IF NOT EXISTS content_hash text;

ALTER TABLE public.canvas_document_versions
  ADD COLUMN IF NOT EXISTS content_hash text;

CREATE OR REPLACE FUNCTION private.canvas_document_hash(p_document jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = pg_catalog
AS $$
  SELECT md5(p_document::text);
$$;

CREATE OR REPLACE FUNCTION public.canvas_documents_set_content_hash()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, private, pg_temp
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.document IS NOT DISTINCT FROM OLD.document
     AND NEW.content_hash IS NOT DISTINCT FROM OLD.content_hash
     AND NEW.content_hash IS NOT NULL THEN
    RETURN NEW;
  END IF;
  NEW.content_hash := private.canvas_document_hash(NEW.document);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.canvas_document_versions_set_content_hash()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, private, pg_temp
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.document IS NOT DISTINCT FROM OLD.document
     AND NEW.content_hash IS NOT DISTINCT FROM OLD.content_hash
     AND NEW.content_hash IS NOT NULL THEN
    RETURN NEW;
  END IF;
  NEW.content_hash := private.canvas_document_hash(NEW.document);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS canvas_documents_content_hash_trigger
  ON public.canvas_documents;
CREATE TRIGGER canvas_documents_content_hash_trigger
BEFORE INSERT OR UPDATE OF document
ON public.canvas_documents
FOR EACH ROW
EXECUTE FUNCTION public.canvas_documents_set_content_hash();

DROP TRIGGER IF EXISTS canvas_document_versions_content_hash_trigger
  ON public.canvas_document_versions;
CREATE TRIGGER canvas_document_versions_content_hash_trigger
BEFORE INSERT OR UPDATE OF document
ON public.canvas_document_versions
FOR EACH ROW
EXECUTE FUNCTION public.canvas_document_versions_set_content_hash();

CREATE INDEX IF NOT EXISTS idx_canvas_document_versions_content_hash
  ON public.canvas_document_versions (document_id, content_hash, created_at DESC)
  WHERE content_hash IS NOT NULL;

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
          OFFSET GREATEST(COALESCE(p_keep, 50), 0)
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
SET search_path = pg_catalog, private, pg_temp
AS $$
DECLARE
  v_id uuid;
  v_existing_id uuid;
  v_has_hashed_candidate boolean;
  v_created_at timestamptz := COALESCE(p_created_at, now());
  v_content_hash text;
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

  SELECT id
    INTO v_existing_id
    FROM public.canvas_document_versions
   WHERE document_id = p_document_id
     AND created_at = v_created_at
     AND content_hash IS NULL
     AND document = p_document
   ORDER BY id
   LIMIT 1;
  IF FOUND THEN
    RETURN v_existing_id;
  END IF;

  SELECT EXISTS (
    SELECT 1
      FROM public.canvas_document_versions
     WHERE document_id = p_document_id
       AND created_at = v_created_at
       AND content_hash IS NOT NULL
  )
    INTO v_has_hashed_candidate;
  IF v_has_hashed_candidate THEN
    v_content_hash := private.canvas_document_hash(p_document);
    SELECT id
      INTO v_existing_id
      FROM public.canvas_document_versions
     WHERE document_id = p_document_id
       AND created_at = v_created_at
       AND content_hash = v_content_hash
     ORDER BY id
     LIMIT 1;
    IF FOUND THEN
      RETURN v_existing_id;
    END IF;
  END IF;

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

CREATE OR REPLACE FUNCTION public.canvas_documents_snapshot_and_prune()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, private, pg_temp
AS $$
BEGIN
  IF NEW.document IS NOT DISTINCT FROM OLD.document THEN
    RETURN NEW;
  END IF;

  PERFORM private.canvas_record_document_version(
    OLD.id,
    OLD.document,
    OLD.updated_by,
    OLD.updated_at
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.canvas_append_document_version(
  p_document_id uuid,
  p_document jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, private, pg_temp
AS $$
DECLARE
  v_created_at timestamptz;
BEGIN
  IF NOT private.is_active_user() THEN
    RAISE EXCEPTION 'Usuario no autorizado';
  END IF;

  v_created_at := COALESCE(NULLIF(p_document->>'updatedAt', '')::timestamptz, now());
  RETURN private.canvas_record_document_version(
    p_document_id,
    p_document,
    auth.uid(),
    v_created_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.canvas_documents_enforce_lww()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, private, pg_temp
AS $$
BEGIN
  IF NEW.updated_at < OLD.updated_at THEN
    PERFORM private.canvas_record_document_version(
      NEW.id,
      NEW.document,
      NEW.updated_by,
      NEW.updated_at
    );
    RETURN NULL;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.canvas_push_document_lww(
  p_document jsonb,
  p_updated_at timestamptz DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, private, pg_temp
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

  PERFORM private.canvas_assert_document_within_limit(p_document);
  IF p_document->>'id' IS NULL THEN
    RAISE EXCEPTION 'El documento Canvas requiere un id';
  END IF;

  v_uid := auth.uid();
  v_id := (p_document->>'id')::uuid;
  v_name := COALESCE(NULLIF(p_document->>'name', ''), 'Sin título');
  v_updated_at := COALESCE(
    p_updated_at,
    (p_document->>'updatedAt')::timestamptz,
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
      PERFORM private.canvas_record_document_version(
        v_id,
        p_document,
        v_uid,
        v_updated_at
      );
      RETURN false;
    END IF;

    IF v_existing.updated_at = v_updated_at
       AND v_existing.deleted_at IS NULL THEN
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

CREATE OR REPLACE FUNCTION public.canvas_reconcile_storage_usage()
RETURNS TABLE (
  document_bytes bigint,
  version_bytes bigint,
  max_total_bytes bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, pg_temp
AS $$
BEGIN
  IF COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Sólo service_role puede reconciliar el almacenamiento Canvas';
  END IF;

  UPDATE public.canvas_storage_usage
     SET document_bytes = COALESCE((
           SELECT SUM(private.canvas_payload_bytes(document))::bigint
             FROM public.canvas_documents
         ), 0),
         version_bytes = COALESCE((
           SELECT SUM(private.canvas_payload_bytes(document))::bigint
             FROM public.canvas_document_versions
         ), 0),
         updated_at = now()
   WHERE id = true;

  RETURN QUERY
  SELECT usage.document_bytes, usage.version_bytes, usage.max_total_bytes
    FROM public.canvas_storage_usage AS usage
   WHERE usage.id = true;
END;
$$;

CREATE OR REPLACE FUNCTION public.canvas_maintenance(p_limit integer DEFAULT 25)
RETURNS TABLE (
  deleted_versions integer,
  purged_documents integer,
  document_bytes bigint,
  version_bytes bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, pg_temp
AS $$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 25), 1), 100);
  v_document_id uuid;
  v_deleted_versions integer := 0;
  v_purged_documents integer := 0;
BEGIN
  IF COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Sólo service_role puede ejecutar mantenimiento Canvas';
  END IF;

  FOR v_document_id IN
    SELECT version_row.document_id
      FROM public.canvas_document_versions AS version_row
     GROUP BY version_row.document_id
     ORDER BY MIN(version_row.created_at), version_row.document_id
     LIMIT v_limit
  LOOP
    PERFORM 1
      FROM public.canvas_documents
     WHERE id = v_document_id
     FOR UPDATE;
    IF NOT FOUND THEN
      CONTINUE;
    END IF;
    v_deleted_versions := v_deleted_versions
      + COALESCE(private.canvas_prune_document_versions(v_document_id, 50), 0);
  END LOOP;

  v_purged_documents := private.canvas_purge_deleted_documents(v_limit);

  RETURN QUERY
  SELECT
    v_deleted_versions,
    v_purged_documents,
    usage.document_bytes,
    usage.version_bytes
    FROM public.canvas_storage_usage AS usage
   WHERE usage.id = true;
END;
$$;

REVOKE ALL ON FUNCTION public.canvas_reconcile_storage_usage() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.canvas_reconcile_storage_usage() TO service_role;

REVOKE ALL ON FUNCTION public.canvas_maintenance(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.canvas_maintenance(integer) TO service_role;

REVOKE ALL ON FUNCTION public.canvas_documents_set_content_hash() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.canvas_document_versions_set_content_hash() FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION private.canvas_document_hash(jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.canvas_prune_document_versions(uuid, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.canvas_record_document_version(uuid, jsonb, uuid, timestamptz)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.canvas_append_document_version(uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.canvas_append_document_version(uuid, jsonb)
  TO authenticated, service_role;
REVOKE ALL ON FUNCTION private.canvas_push_document_lww(jsonb, timestamptz)
  FROM PUBLIC, anon, authenticated;
