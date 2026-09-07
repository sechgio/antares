-- Limits live here: clients have several write paths, and JSONB snapshots
-- with images can dominate storage.

CREATE OR REPLACE FUNCTION private.canvas_payload_bytes(p_document jsonb)
RETURNS bigint
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = pg_catalog
AS $$
  SELECT octet_length(convert_to(p_document::text, 'UTF8'))::bigint;
$$;

CREATE TABLE IF NOT EXISTS public.canvas_storage_usage (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  document_bytes bigint NOT NULL DEFAULT 0 CHECK (document_bytes >= 0),
  version_bytes bigint NOT NULL DEFAULT 0 CHECK (version_bytes >= 0),
  -- 256 MiB leaves room for the rest of the app; service_role can raise it.
  max_total_bytes bigint NOT NULL DEFAULT 268435456 CHECK (max_total_bytes > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.canvas_storage_usage ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION private.canvas_assert_document_within_limit(p_document jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_bytes bigint;
BEGIN
  IF p_document IS NULL OR jsonb_typeof(p_document) <> 'object' THEN
    RAISE EXCEPTION 'El documento Canvas debe ser un objeto JSON'
      USING ERRCODE = '22023';
  END IF;

  v_bytes := private.canvas_payload_bytes(p_document);
  IF v_bytes > 16777216 THEN
    RAISE EXCEPTION 'El documento Canvas excede el límite de 16 MiB (% bytes)', v_bytes
      USING ERRCODE = '22023';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION private.canvas_storage_apply_delta(
  p_document_delta bigint,
  p_version_delta bigint
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_usage public.canvas_storage_usage%ROWTYPE;
  v_document_delta bigint := COALESCE(p_document_delta, 0);
  v_version_delta bigint := COALESCE(p_version_delta, 0);
  v_document_bytes bigint;
  v_version_bytes bigint;
  v_total_bytes bigint;
BEGIN
  SELECT *
    INTO v_usage
    FROM public.canvas_storage_usage
   WHERE id = true
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No existe el contador de almacenamiento de Canvas';
  END IF;

  v_document_bytes := v_usage.document_bytes + v_document_delta;
  v_version_bytes := v_usage.version_bytes + v_version_delta;
  IF v_document_bytes < 0 OR v_version_bytes < 0 THEN
    RAISE EXCEPTION 'El contador de almacenamiento de Canvas quedó inconsistente';
  END IF;

  v_total_bytes := v_document_bytes + v_version_bytes;
  IF v_total_bytes > v_usage.max_total_bytes
     AND (v_document_delta > 0 OR v_version_delta > 0) THEN
    RAISE EXCEPTION
      'La cuota de almacenamiento de Canvas fue alcanzada (% de % bytes)',
      v_total_bytes,
      v_usage.max_total_bytes
      USING ERRCODE = '53400';
  END IF;

  UPDATE public.canvas_storage_usage
     SET document_bytes = v_document_bytes,
         version_bytes = v_version_bytes,
         updated_at = now()
   WHERE id = true;
END;
$$;

CREATE OR REPLACE FUNCTION public.canvas_documents_storage_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_new_bytes bigint := 0;
  v_old_bytes bigint := 0;
BEGIN
  IF TG_OP <> 'DELETE' THEN
    PERFORM private.canvas_assert_document_within_limit(NEW.document);
    v_new_bytes := private.canvas_payload_bytes(NEW.document);
  END IF;

  IF TG_OP <> 'INSERT' THEN
    v_old_bytes := private.canvas_payload_bytes(OLD.document);
  END IF;

  PERFORM private.canvas_storage_apply_delta(v_new_bytes - v_old_bytes, 0);

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.canvas_document_versions_storage_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_new_bytes bigint := 0;
  v_old_bytes bigint := 0;
BEGIN
  IF TG_OP <> 'DELETE' THEN
    PERFORM private.canvas_assert_document_within_limit(NEW.document);
    v_new_bytes := private.canvas_payload_bytes(NEW.document);
  END IF;

  IF TG_OP <> 'INSERT' THEN
    v_old_bytes := private.canvas_payload_bytes(OLD.document);
  END IF;

  PERFORM private.canvas_storage_apply_delta(0, v_new_bytes - v_old_bytes);

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'public.canvas_documents'::regclass
       AND conname = 'canvas_documents_document_size_check'
  ) THEN
    ALTER TABLE public.canvas_documents
      ADD CONSTRAINT canvas_documents_document_size_check
      CHECK (octet_length(convert_to(document::text, 'UTF8')) <= 16777216)
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'public.canvas_document_versions'::regclass
       AND conname = 'canvas_document_versions_document_size_check'
  ) THEN
    ALTER TABLE public.canvas_document_versions
      ADD CONSTRAINT canvas_document_versions_document_size_check
      CHECK (octet_length(convert_to(document::text, 'UTF8')) <= 16777216)
      NOT VALID;
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_canvas_documents_deleted_at_retention
  ON public.canvas_documents (deleted_at, id)
  WHERE deleted_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_canvas_document_versions_created_at
  ON public.canvas_document_versions (created_at DESC, id DESC);

CREATE OR REPLACE FUNCTION private.canvas_prune_document_versions(p_document_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_deleted integer;
BEGIN
  DELETE FROM public.canvas_document_versions AS version_row
   WHERE version_row.document_id = p_document_id
     AND (
       version_row.created_at < now() - interval '90 days'
       OR version_row.id IN (
         SELECT retained.id
           FROM public.canvas_document_versions AS retained
          WHERE retained.document_id = p_document_id
          ORDER BY retained.created_at DESC, retained.id DESC
          OFFSET 50
       )
     );

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

-- One-shot prune of rows written before every path used bounded retention.
DELETE FROM public.canvas_document_versions AS version_row
 WHERE version_row.created_at < now() - interval '90 days'
    OR version_row.id IN (
      SELECT retained.id
        FROM public.canvas_document_versions AS retained
       WHERE retained.document_id = version_row.document_id
       ORDER BY retained.created_at DESC, retained.id DESC
       OFFSET 50
    );

DELETE FROM public.canvas_documents
 WHERE deleted_at IS NOT NULL
   AND deleted_at < now() - interval '30 days';

INSERT INTO public.canvas_storage_usage (id, document_bytes, version_bytes)
VALUES (
  true,
  COALESCE(
    (SELECT SUM(private.canvas_payload_bytes(document))::bigint
     FROM public.canvas_documents),
    0
  ),
  COALESCE(
    (SELECT SUM(private.canvas_payload_bytes(document))::bigint
     FROM public.canvas_document_versions),
    0
  )
)
ON CONFLICT (id) DO NOTHING;

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

  -- Prune first so the storage trigger has quota for the new snapshot.
  PERFORM private.canvas_prune_document_versions(p_document_id);

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
    COALESCE(p_created_at, now())
  )
  RETURNING id INTO v_id;

  -- Insert can push the doc over 50; prune again after the write.
  PERFORM private.canvas_prune_document_versions(p_document_id);
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.canvas_documents_snapshot_and_prune()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
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
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF NOT private.is_active_user() THEN
    RAISE EXCEPTION 'Usuario no autorizado';
  END IF;

  RETURN private.canvas_record_document_version(
    p_document_id,
    p_document,
    auth.uid(),
    now()
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.canvas_documents_enforce_lww()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
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

CREATE OR REPLACE FUNCTION private.canvas_purge_deleted_documents(p_limit integer DEFAULT 25)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_deleted integer;
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 25), 1), 100);
BEGIN
  WITH doomed AS (
    SELECT id
      FROM public.canvas_documents
     WHERE deleted_at IS NOT NULL
       AND deleted_at < now() - interval '30 days'
     ORDER BY deleted_at ASC, id ASC
     LIMIT v_limit
  )
  DELETE FROM public.canvas_documents AS document_row
   USING doomed
   WHERE document_row.id = doomed.id;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

CREATE OR REPLACE FUNCTION private.canvas_push_document_lww(
  p_document jsonb,
  p_updated_at timestamptz DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_uid uuid;
  v_id uuid;
  v_name text;
  v_updated_at timestamptz;
  v_existing public.canvas_documents%ROWTYPE;
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

  -- Bounded purge on write so clients never run an unbounded maintenance query.
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

DROP TRIGGER IF EXISTS canvas_documents_storage_guard_trigger
  ON public.canvas_documents;
CREATE TRIGGER canvas_documents_storage_guard_trigger
AFTER INSERT OR UPDATE OF document OR DELETE
ON public.canvas_documents
FOR EACH ROW
EXECUTE FUNCTION public.canvas_documents_storage_guard();

DROP TRIGGER IF EXISTS canvas_document_versions_storage_guard_trigger
  ON public.canvas_document_versions;
CREATE TRIGGER canvas_document_versions_storage_guard_trigger
AFTER INSERT OR UPDATE OR DELETE
ON public.canvas_document_versions
FOR EACH ROW
EXECUTE FUNCTION public.canvas_document_versions_storage_guard();

-- Retired client-side LWW overloads.
DROP FUNCTION IF EXISTS public.canvas_push_document_lww(
  uuid,
  text,
  jsonb,
  timestamptz,
  boolean
);
DROP FUNCTION IF EXISTS public.canvas_delete_document_lww(uuid, timestamptz);

REVOKE ALL ON TABLE public.canvas_storage_usage FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.canvas_storage_usage TO service_role;

REVOKE ALL ON FUNCTION private.canvas_payload_bytes(jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.canvas_assert_document_within_limit(jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.canvas_storage_apply_delta(bigint, bigint)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.canvas_prune_document_versions(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.canvas_record_document_version(uuid, jsonb, uuid, timestamptz)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.canvas_purge_deleted_documents(integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.canvas_documents_storage_guard()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.canvas_document_versions_storage_guard()
  FROM PUBLIC, anon, authenticated;
