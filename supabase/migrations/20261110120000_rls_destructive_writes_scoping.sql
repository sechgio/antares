-- Refuerzo de autoridad en escrituras destructivas (sb-001/002/003/005/007).
-- Modelo decidido: las lecturas y las ediciones colaborativas siguen de equipo;
-- el BORRADO destructivo exige autoría o administración; los documentos Canvas
-- se escriben solo por su creador o un administrador; las columnas de sistema
-- del tablero quedan fijas; y el LWW deja de obedecer relojes de cliente en el
-- futuro (ventana de sesgo: 5 minutos).

-- ── 1) espacios: DELETE solo creador o admin (sb-002) ─────────────────────────
-- created_by existe desde 0003 y 0009 fuerza su atribución en INSERT.
DROP POLICY IF EXISTS "espacios_active_users_all" ON public.espacios;

CREATE POLICY "espacios_active_users_read"
  ON public.espacios
  FOR SELECT
  TO authenticated
  USING ((SELECT private.is_active_user()));

CREATE POLICY "espacios_active_users_insert"
  ON public.espacios
  FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT private.is_active_user()));

CREATE POLICY "espacios_active_users_update"
  ON public.espacios
  FOR UPDATE
  TO authenticated
  USING ((SELECT private.is_active_user()))
  WITH CHECK ((SELECT private.is_active_user()));

CREATE POLICY "espacios_active_users_delete"
  ON public.espacios
  FOR DELETE
  TO authenticated
  USING (
    (SELECT private.is_active_user())
    AND (created_by = (SELECT auth.uid()) OR (SELECT private.is_admin()))
  );

-- ── 2) proyectos: DELETE por el dueño del espacio padre o admin (sb-002) ─────
-- proyectos no lleva created_by; la autoría vive en el espacio que lo contiene.
DROP POLICY IF EXISTS "proyectos_active_users_all" ON public.proyectos;

CREATE POLICY "proyectos_active_users_read"
  ON public.proyectos
  FOR SELECT
  TO authenticated
  USING ((SELECT private.is_active_user()));

CREATE POLICY "proyectos_active_users_insert"
  ON public.proyectos
  FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT private.is_active_user()));

CREATE POLICY "proyectos_active_users_update"
  ON public.proyectos
  FOR UPDATE
  TO authenticated
  USING ((SELECT private.is_active_user()))
  WITH CHECK ((SELECT private.is_active_user()));

CREATE POLICY "proyectos_active_users_delete"
  ON public.proyectos
  FOR DELETE
  TO authenticated
  USING (
    (SELECT private.is_active_user())
    AND EXISTS (
      SELECT 1
      FROM public.espacios AS espacio
      WHERE espacio.id = proyectos.espacio_id
        AND (espacio.created_by = (SELECT auth.uid()) OR (SELECT private.is_admin()))
    )
  );

-- ── 3) tareas: DELETE solo creador o admin (sb-002) ──────────────────────────
-- La reasignación (assignee_id) y las ediciones siguen de equipo.
DROP POLICY IF EXISTS "tareas_active_users_all" ON public.tareas;

CREATE POLICY "tareas_active_users_read"
  ON public.tareas
  FOR SELECT
  TO authenticated
  USING ((SELECT private.is_active_user()));

CREATE POLICY "tareas_active_users_insert"
  ON public.tareas
  FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT private.is_active_user()));

CREATE POLICY "tareas_active_users_update"
  ON public.tareas
  FOR UPDATE
  TO authenticated
  USING ((SELECT private.is_active_user()))
  WITH CHECK ((SELECT private.is_active_user()));

CREATE POLICY "tareas_active_users_delete"
  ON public.tareas
  FOR DELETE
  TO authenticated
  USING (
    (SELECT private.is_active_user())
    AND (created_by = (SELECT auth.uid()) OR (SELECT private.is_admin()))
  );

-- ── 4) canvas: UPDATE solo creador o admin (sb-001) ──────────────────────────
DROP POLICY IF EXISTS "canvas_documents_active_users_update" ON public.canvas_documents;

CREATE POLICY "canvas_documents_owner_update"
  ON public.canvas_documents
  FOR UPDATE
  TO authenticated
  USING (
    (SELECT private.is_active_user())
    AND (created_by = (SELECT auth.uid()) OR (SELECT private.is_admin()))
  )
  WITH CHECK (
    (SELECT private.is_active_user())
    AND (created_by = (SELECT auth.uid()) OR (SELECT private.is_admin()))
  );

-- ── 5) canvas_append_document_version: sin IDOR (sb-003) ─────────────────────
-- La versión se anexa solo al documento propio (o siendo admin); el documento
-- debe existir y lo verifica en el mismo statement.
CREATE OR REPLACE FUNCTION private.canvas_append_document_version(p_document_id uuid, p_document jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, pg_temp
AS $$
DECLARE
  v_id uuid;
  v_owner uuid;
  v_found boolean;
BEGIN
  IF NOT private.is_active_user() THEN
    RAISE EXCEPTION 'Usuario no autorizado';
  END IF;
  IF p_document_id IS NULL THEN
    RAISE EXCEPTION 'El documento Canvas requiere un id';
  END IF;

  SELECT created_by IS NOT NULL, created_by
    INTO v_found, v_owner
    FROM public.canvas_documents
   WHERE id = p_document_id;

  IF NOT v_found THEN
    RAISE EXCEPTION 'El documento Canvas no existe';
  END IF;
  IF v_owner IS DISTINCT FROM auth.uid() AND NOT private.is_admin() THEN
    RAISE EXCEPTION 'Solo el creador del documento o un administrador puede añadir versiones';
  END IF;

  INSERT INTO public.canvas_document_versions (document_id, document, created_by, created_at)
  VALUES (p_document_id, p_document, auth.uid(), now())
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION private.canvas_append_document_version(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.canvas_append_document_version(uuid, jsonb) TO authenticated, service_role;

-- ── 6) LWW sin relojes de cliente en el futuro (sb-005) ──────────────────────
-- Un timestamp futuro apodaría el arbitraje para siempre. Se rechaza
-- cualquier marca más allá de 5 minutos de reloj del servidor y, por la misma
-- vía, un documento Canvas ajeno deja de escribirse por RPC (sb-001).
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
  v_existing_created_by uuid;
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

  IF v_updated_at > pg_catalog.clock_timestamp() + INTERVAL '5 minutes' THEN
    RAISE EXCEPTION 'La marca de tiempo del documento Canvas está en el futuro';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_id::text, 0));

  IF pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtext('canvas_documents_purge')) THEN
    PERFORM private.canvas_purge_deleted_documents(25);
  END IF;

  SELECT id, updated_at, deleted_at, created_by, content_hash
    INTO v_existing_id, v_existing_updated_at, v_existing_deleted_at, v_existing_created_by, v_existing_hash
    FROM public.canvas_documents
   WHERE id = v_id
   FOR UPDATE;

  IF FOUND
     AND v_existing_created_by IS DISTINCT FROM v_uid
     AND NOT private.is_admin() THEN
    RAISE EXCEPTION 'Solo el creador del documento o un administrador puede escribirlo';
  END IF;

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

REVOKE ALL ON FUNCTION private.canvas_push_document_lww_v2(jsonb, timestamptz, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.canvas_push_document_lww_v2(jsonb, timestamptz, boolean)
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
  v_existing_updated_at timestamptz;
  v_existing_deleted_at timestamptz;
  v_existing_created_by uuid;
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

  SELECT updated_at, deleted_at, created_by
    INTO v_existing_updated_at, v_existing_deleted_at, v_existing_created_by
    FROM public.canvas_documents
   WHERE id = p_id
   FOR UPDATE;

  IF FOUND
     AND v_existing_created_by IS DISTINCT FROM v_uid
     AND NOT private.is_admin() THEN
    RAISE EXCEPTION 'Solo el creador del documento o un administrador puede eliminarlo';
  END IF;

  IF NOT FOUND OR v_existing_deleted_at IS NOT NULL THEN
    RETURN FOUND;
  END IF;

  IF COALESCE(p_deleted_at, clock_timestamp()) > pg_catalog.clock_timestamp() + INTERVAL '5 minutes' THEN
    RAISE EXCEPTION 'La marca de tiempo del borrado está en el futuro';
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

REVOKE ALL ON FUNCTION private.canvas_delete_document_lww_v2(uuid, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.canvas_delete_document_lww_v2(uuid, timestamptz)
  TO authenticated, service_role;

-- ── 7) columnas de sistema del tablero fijas (sb-007) ────────────────────────
-- El guard de 0009 impide borrarlas; también impide degradarlas
-- (is_system=false), renombrarlas o alterar su semántica por UPDATE.
CREATE OR REPLACE FUNCTION public.board_columns_protect_system_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, private
AS $$
BEGIN
  IF OLD.is_system THEN
    RAISE EXCEPTION 'Las columnas de sistema del tablero no se modifican';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.board_columns_protect_system_columns() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS board_columns_protect_system_columns ON public.board_columns;
CREATE TRIGGER board_columns_protect_system_columns
  BEFORE UPDATE ON public.board_columns
  FOR EACH ROW
  EXECUTE FUNCTION public.board_columns_protect_system_columns();
