-- Keep the PostgREST RPC contract while moving privileged implementations
-- out of the exposed public schema.
CREATE SCHEMA IF NOT EXISTS private;

REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

CREATE OR REPLACE FUNCTION private.is_active_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL
    AND NOT COALESCE(
      (SELECT is_disabled FROM public.user_profiles WHERE user_id = auth.uid()),
      false
    );
$$;

CREATE OR REPLACE FUNCTION private.is_admin()
RETURNS boolean
LANGUAGE sql
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

CREATE OR REPLACE FUNCTION private.admin_list_users()
RETURNS TABLE (
  user_id uuid,
  email text,
  display_name text,
  is_admin boolean,
  is_disabled boolean,
  created_at timestamptz,
  last_sign_in_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    u.id AS user_id,
    u.email,
    p.display_name,
    p.is_admin,
    p.is_disabled,
    u.created_at,
    u.last_sign_in_at
  FROM auth.users u
  LEFT JOIN public.user_profiles p ON p.user_id = u.id
  WHERE private.is_admin();
$$;

CREATE OR REPLACE FUNCTION private.admin_set_admin(p_user_id uuid, p_is_admin boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admins integer;
BEGIN
  IF NOT private.is_admin() THEN
    RAISE EXCEPTION 'Solo los administradores pueden cambiar roles';
  END IF;
  IF p_user_id = auth.uid() AND NOT p_is_admin THEN
    RAISE EXCEPTION 'No puedes quitarte el rol de administrador a ti mismo';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(0, 983742);
  PERFORM 1 FROM public.user_profiles WHERE user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Usuario no encontrado';
  END IF;

  IF NOT p_is_admin THEN
    SELECT count(*) INTO v_admins
    FROM public.user_profiles
    WHERE is_admin = true AND COALESCE(is_disabled, false) = false;
    IF EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE user_id = p_user_id AND is_admin = true AND COALESCE(is_disabled, false) = false
    ) AND v_admins <= 1 THEN
      RAISE EXCEPTION 'No se puede degradar al último administrador activo';
    END IF;
  END IF;

  UPDATE public.user_profiles SET is_admin = p_is_admin WHERE user_id = p_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION private.admin_toggle_disabled(p_user_id uuid, p_disabled boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admins integer;
BEGIN
  IF NOT private.is_admin() THEN
    RAISE EXCEPTION 'Solo los administradores pueden deshabilitar usuarios';
  END IF;
  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'No puedes desactivar tu propia cuenta';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(0, 983742);
  PERFORM 1 FROM public.user_profiles WHERE user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Usuario no encontrado';
  END IF;

  IF p_disabled THEN
    SELECT count(*) INTO v_admins
    FROM public.user_profiles
    WHERE is_admin = true AND COALESCE(is_disabled, false) = false;
    IF EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE user_id = p_user_id AND is_admin = true AND COALESCE(is_disabled, false) = false
    ) AND v_admins <= 1 THEN
      RAISE EXCEPTION 'No se puede deshabilitar al último administrador activo';
    END IF;
  END IF;

  UPDATE public.user_profiles
  SET is_disabled = p_disabled, updated_at = now()
  WHERE user_id = p_user_id;
  IF p_disabled THEN
    UPDATE auth.users SET banned_until = '9999-12-31 23:59:59+00' WHERE id = p_user_id;
    DELETE FROM auth.sessions WHERE user_id = p_user_id;
    DELETE FROM auth.refresh_tokens WHERE user_id = p_user_id::text;
  ELSE
    UPDATE auth.users SET banned_until = NULL WHERE id = p_user_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION private.admin_delete_user(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target_is_admin boolean;
  v_target_disabled boolean;
  v_admins integer;
BEGIN
  IF NOT private.is_admin() THEN
    RAISE EXCEPTION 'Solo los administradores pueden eliminar usuarios';
  END IF;
  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'No puedes eliminar tu propia cuenta';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(0, 983742);

  SELECT is_admin, COALESCE(is_disabled, false)
  INTO v_target_is_admin, v_target_disabled
  FROM public.user_profiles
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Usuario no encontrado';
  END IF;

  IF v_target_is_admin AND NOT v_target_disabled THEN
    SELECT count(*)
    INTO v_admins
    FROM public.user_profiles
    WHERE is_admin = true AND COALESCE(is_disabled, false) = false;
    IF v_admins <= 1 THEN
      RAISE EXCEPTION 'No se puede eliminar al último administrador activo';
    END IF;
  END IF;

  DELETE FROM auth.users WHERE id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Usuario no encontrado';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION private.canvas_append_document_version(p_document_id uuid, p_document jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT private.is_active_user() THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;
  INSERT INTO public.canvas_document_versions (document_id, document, created_by, created_at)
  VALUES (p_document_id, p_document, auth.uid(), now())
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION private.canvas_push_document_lww(
  p_document jsonb,
  p_updated_at timestamptz DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
  v_id uuid;
  v_name text;
  v_updated_at timestamptz;
  v_existing record;
BEGIN
  IF NOT private.is_active_user() THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;
  IF p_document IS NULL OR jsonb_typeof(p_document) <> 'object' OR p_document->>'id' IS NULL THEN
    RAISE EXCEPTION 'Documento Canvas inválido';
  END IF;

  v_uid := auth.uid();
  v_id := (p_document->>'id')::uuid;
  v_name := coalesce(p_document->>'name', 'Sin título');
  v_updated_at := coalesce(p_updated_at, (p_document->>'updatedAt')::timestamptz, now());

  SELECT updated_at, deleted_at, created_by
  INTO v_existing
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
    SET name = v_name,
        document = p_document,
        updated_at = v_updated_at,
        updated_by = v_uid,
        deleted_at = NULL
    WHERE id = v_id;
    RETURN true;
  END IF;

  INSERT INTO public.canvas_documents (id, name, document, updated_at, updated_by, created_by, deleted_at)
  VALUES (v_id, v_name, p_document, v_updated_at, v_uid, v_uid, NULL);
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION private.seed_default_board_columns(p_proyecto_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT private.is_active_user() THEN
    RAISE EXCEPTION 'Usuario no autorizado';
  END IF;

  INSERT INTO public.board_columns (proyecto_id, key, name, color, sort_order, is_done, is_system)
  VALUES
    (p_proyecto_id, 'todo', 'Pendiente', '#87909E', 0, false, true),
    (p_proyecto_id, 'in_progress', 'En curso', '#5F55EE', 1, false, true),
    (p_proyecto_id, 'done', 'Completados', '#0F9D58', 2, true, true),
    (p_proyecto_id, 'urgent', 'Urgente', '#EF4444', 3, false, true),
    (p_proyecto_id, 'closed', 'Cerrada', '#64748B', 4, true, true)
  ON CONFLICT (proyecto_id, key) DO NOTHING;
END;
$$;

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
    AND private.is_active_user();
$$;

REVOKE ALL ON FUNCTION private.is_active_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.is_admin() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.admin_list_users() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.admin_set_admin(uuid, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.admin_toggle_disabled(uuid, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.admin_delete_user(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.canvas_append_document_version(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.canvas_push_document_lww(jsonb, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.seed_default_board_columns(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.team_list_members() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION private.is_active_user() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.is_admin() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.admin_list_users() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.admin_set_admin(uuid, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.admin_toggle_disabled(uuid, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.admin_delete_user(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.canvas_append_document_version(uuid, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.canvas_push_document_lww(jsonb, timestamptz) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.seed_default_board_columns(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.team_list_members() TO authenticated, service_role;

-- Public wrappers preserve the existing RPC names and signatures without
-- running with elevated privileges themselves.
CREATE OR REPLACE FUNCTION public.is_active_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, private
AS $$ SELECT private.is_active_user(); $$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY INVOKER
SET search_path = public, private
AS $$ SELECT private.is_admin(); $$;

CREATE OR REPLACE FUNCTION public.admin_list_users()
RETURNS TABLE (
  user_id uuid,
  email text,
  display_name text,
  is_admin boolean,
  is_disabled boolean,
  created_at timestamptz,
  last_sign_in_at timestamptz
)
LANGUAGE sql
SECURITY INVOKER
SET search_path = public, private
AS $$ SELECT * FROM private.admin_list_users(); $$;

CREATE OR REPLACE FUNCTION public.admin_set_admin(p_user_id uuid, p_is_admin boolean)
RETURNS void
LANGUAGE sql
SECURITY INVOKER
SET search_path = public, private
AS $$ SELECT private.admin_set_admin(p_user_id, p_is_admin); $$;

CREATE OR REPLACE FUNCTION public.admin_toggle_disabled(p_user_id uuid, p_disabled boolean)
RETURNS void
LANGUAGE sql
SECURITY INVOKER
SET search_path = public, private
AS $$ SELECT private.admin_toggle_disabled(p_user_id, p_disabled); $$;

CREATE OR REPLACE FUNCTION public.admin_delete_user(p_user_id uuid)
RETURNS void
LANGUAGE sql
SECURITY INVOKER
SET search_path = public, private
AS $$ SELECT private.admin_delete_user(p_user_id); $$;

CREATE OR REPLACE FUNCTION public.canvas_append_document_version(p_document_id uuid, p_document jsonb)
RETURNS uuid
LANGUAGE sql
SECURITY INVOKER
SET search_path = public, private
AS $$ SELECT private.canvas_append_document_version(p_document_id, p_document); $$;

CREATE OR REPLACE FUNCTION public.canvas_push_document_lww(
  p_document jsonb,
  p_updated_at timestamptz DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql
SECURITY INVOKER
SET search_path = public, private
AS $$ SELECT private.canvas_push_document_lww(p_document, p_updated_at); $$;

CREATE OR REPLACE FUNCTION public.seed_default_board_columns(p_proyecto_id uuid)
RETURNS void
LANGUAGE sql
SECURITY INVOKER
SET search_path = public, private
AS $$ SELECT private.seed_default_board_columns(p_proyecto_id); $$;

CREATE OR REPLACE FUNCTION public.team_list_members()
RETURNS TABLE (user_id uuid, display_name text)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, private
AS $$ SELECT * FROM private.team_list_members(); $$;

REVOKE ALL ON FUNCTION public.is_active_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_list_users() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_set_admin(uuid, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_toggle_disabled(uuid, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_delete_user(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.canvas_append_document_version(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.canvas_push_document_lww(jsonb, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.seed_default_board_columns(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.team_list_members() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.is_active_user() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_users() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_admin(uuid, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_toggle_disabled(uuid, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_delete_user(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.canvas_append_document_version(uuid, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.canvas_push_document_lww(jsonb, timestamptz) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.seed_default_board_columns(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.team_list_members() TO authenticated, service_role;

-- RLS policies call the private helpers directly so they don't depend on an
-- exposed function for authorization decisions.
ALTER POLICY "board_columns_active_users_all" ON public.board_columns
  USING ((SELECT private.is_active_user()))
  WITH CHECK ((SELECT private.is_active_user()));

ALTER POLICY "canvas_doc_versions_active_users_insert" ON public.canvas_document_versions
  WITH CHECK ((SELECT private.is_active_user()));

ALTER POLICY "canvas_doc_versions_active_users_select" ON public.canvas_document_versions
  USING ((SELECT private.is_active_user()));

ALTER POLICY "canvas_documents_active_users_insert" ON public.canvas_documents
  WITH CHECK ((SELECT private.is_active_user()));

ALTER POLICY "canvas_documents_active_users_select" ON public.canvas_documents
  USING ((SELECT private.is_active_user()));

ALTER POLICY "canvas_documents_active_users_update" ON public.canvas_documents
  USING ((SELECT private.is_active_user()))
  WITH CHECK ((SELECT private.is_active_user()));

ALTER POLICY "espacios_active_users_all" ON public.espacios
  USING ((SELECT private.is_active_user()))
  WITH CHECK ((SELECT private.is_active_user()));

ALTER POLICY "proyectos_active_users_all" ON public.proyectos
  USING ((SELECT private.is_active_user()))
  WITH CHECK ((SELECT private.is_active_user()));

ALTER POLICY "tareas_active_users_all" ON public.tareas
  USING ((SELECT private.is_active_user()))
  WITH CHECK ((SELECT private.is_active_user()));

ALTER POLICY "users_and_admins_read_profiles" ON public.user_profiles
  USING (
    user_id = (SELECT auth.uid())
    OR (SELECT private.is_admin())
  );

ALTER POLICY "canvas_realtime_receive" ON realtime.messages
  USING (
    (SELECT private.is_active_user())
    AND extension IN ('broadcast', 'presence')
    AND realtime.topic() LIKE 'canvas-document:%'
  );

ALTER POLICY "canvas_realtime_send" ON realtime.messages
  WITH CHECK (
    (SELECT private.is_active_user())
    AND extension IN ('broadcast', 'presence')
    AND realtime.topic() LIKE 'canvas-document:%'
  );

CREATE OR REPLACE FUNCTION public.user_profiles_guard_privilege_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, private
AS $$
BEGIN
  IF (NEW.is_admin IS DISTINCT FROM OLD.is_admin)
     OR (NEW.is_disabled IS DISTINCT FROM OLD.is_disabled) THEN
    IF NOT private.is_admin() THEN
      RAISE EXCEPTION 'Solo los administradores pueden modificar roles o el estado de la cuenta';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
