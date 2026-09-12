-- Performance audit hardening (2026-09-11):
-- * Legacy canvas_push_document_lww delegates to v2 so old callers keep the
--   tombstone/force_resurrect semantics instead of silently resurrecting.
-- * LWW RPCs stop detoasting the full document on the hot path: they lock and
--   read only metadata, and fetch `document` lazily for the hash fallback.
-- * canvas_storage_apply_delta updates the counter in one statement so the
--   global usage row stays locked for a single UPDATE instead of SELECT+UPDATE.
-- * Storage guards drop the size assert: the CHECK constraints
--   canvas_*_document_size_check already enforce the limit on write.
-- * canvas_record_document_version prunes once (keep=49 before insert) and the
--   size assert moves to the public boundary canvas_append_document_version.
-- * The deleted-document purge runs under a non-blocking advisory lock so
--   concurrent pushes skip it instead of piling up on the same work.
-- * team_list_members evaluates is_active_user() once per call (InitPlan).
-- * private.is_admin() is STABLE like is_active_user().
-- * Indexes: drop dead/redundant ones, add composites for the ordered
--   per-proyecto lists served by the API.

CREATE OR REPLACE FUNCTION private.canvas_push_document_lww(
  p_document jsonb,
  p_updated_at timestamptz DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, pg_temp
AS $$
  SELECT private.canvas_push_document_lww_v2(p_document, p_updated_at, false);
$$;

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
  v_existing_id uuid;
  v_existing_updated_at timestamptz;
  v_existing_deleted_at timestamptz;
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

  IF pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtext('canvas_documents_purge')) THEN
    PERFORM private.canvas_purge_deleted_documents(25);
  END IF;

  SELECT id, updated_at, deleted_at, content_hash
    INTO v_existing_id, v_existing_updated_at, v_existing_deleted_at, v_existing_hash
    FROM public.canvas_documents
   WHERE id = v_id
   FOR UPDATE;

  IF FOUND THEN
    IF NOT p_force_resurrect
       AND (
         v_existing_deleted_at IS NOT NULL
         OR v_updated_at < v_existing_updated_at
       ) THEN
      PERFORM private.canvas_record_document_version(
        v_id,
        p_document,
        v_uid,
        v_updated_at
      );
      RETURN false;
    END IF;

    IF v_existing_deleted_at IS NULL
       AND v_existing_updated_at = v_updated_at THEN
      v_content_hash := private.canvas_document_hash(p_document);
      IF v_existing_hash IS NULL THEN
        SELECT private.canvas_document_hash(existing.document)
          INTO v_existing_hash
          FROM public.canvas_documents AS existing
         WHERE existing.id = v_id;
      END IF;
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
  v_existing_updated_at timestamptz;
  v_existing_deleted_at timestamptz;
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

  SELECT updated_at, deleted_at
    INTO v_existing_updated_at, v_existing_deleted_at
    FROM public.canvas_documents
   WHERE id = p_id
   FOR UPDATE;

  IF NOT FOUND OR v_existing_deleted_at IS NOT NULL THEN
    RETURN FOUND;
  END IF;

  v_deleted_at := GREATEST(COALESCE(p_deleted_at, clock_timestamp()), v_existing_updated_at);
  UPDATE public.canvas_documents
     SET deleted_at = v_deleted_at,
         updated_at = v_deleted_at,
         updated_by = v_uid
   WHERE id = p_id;
  RETURN true;
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
  v_document_delta bigint := COALESCE(p_document_delta, 0);
  v_version_delta bigint := COALESCE(p_version_delta, 0);
  v_document_bytes bigint;
  v_version_bytes bigint;
  v_max_total bigint;
BEGIN
  UPDATE public.canvas_storage_usage
     SET document_bytes = document_bytes + v_document_delta,
         version_bytes = version_bytes + v_version_delta,
         updated_at = now()
   WHERE id = true
  RETURNING document_bytes, version_bytes, max_total_bytes
    INTO v_document_bytes, v_version_bytes, v_max_total;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No existe el contador de almacenamiento de Canvas';
  END IF;

  IF v_document_bytes < 0 OR v_version_bytes < 0 THEN
    RAISE EXCEPTION 'El contador de almacenamiento de Canvas quedó inconsistente';
  END IF;

  IF v_document_bytes + v_version_bytes > v_max_total
     AND (v_document_delta > 0 OR v_version_delta > 0) THEN
    RAISE EXCEPTION
      'La cuota de almacenamiento de Canvas fue alcanzada (% de % bytes)',
      v_document_bytes + v_version_bytes,
      v_max_total
      USING ERRCODE = '53400';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.canvas_documents_storage_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, private, pg_temp
AS $$
DECLARE
  v_old_bytes bigint := 0;
  v_new_bytes bigint := 0;
BEGIN
  IF TG_OP <> 'DELETE' THEN
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
SET search_path = pg_catalog, private, pg_temp
AS $$
DECLARE
  v_old_bytes bigint := 0;
  v_new_bytes bigint := 0;
BEGIN
  IF TG_OP <> 'DELETE' THEN
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

  RETURN v_id;
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

  PERFORM private.canvas_assert_document_within_limit(p_document);
  v_created_at := COALESCE(NULLIF(p_document->>'updatedAt', '')::timestamptz, now());
  RETURN private.canvas_record_document_version(
    p_document_id,
    p_document,
    auth.uid(),
    v_created_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION private.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT is_admin AND NOT COALESCE(is_disabled, false)
      FROM public.user_profiles
      WHERE user_id = auth.uid()
    ),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, private
AS $$ SELECT private.is_admin(); $$;

CREATE OR REPLACE FUNCTION private.team_list_members()
RETURNS TABLE (user_id uuid, display_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    u.id AS user_id,
    COALESCE(p.display_name, split_part(u.email, '@', 1)) AS display_name
  FROM auth.users u
  LEFT JOIN public.user_profiles p ON p.user_id = u.id
  WHERE COALESCE(p.is_disabled, false) = false
    AND (SELECT private.is_active_user());
$$;

DROP INDEX IF EXISTS public.idx_board_columns_proyecto;
DROP INDEX IF EXISTS public.idx_canvas_documents_updated_at;
DROP INDEX IF EXISTS public.idx_canvas_documents_deleted_at;
DROP INDEX IF EXISTS public.idx_tareas_proyecto;

CREATE INDEX IF NOT EXISTS idx_tareas_proyecto_sort
  ON public.tareas (proyecto_id, sort_order, created_at);
CREATE INDEX IF NOT EXISTS idx_board_columns_proyecto_sort
  ON public.board_columns (proyecto_id, sort_order, created_at);
