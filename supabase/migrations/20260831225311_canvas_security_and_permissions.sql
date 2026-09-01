-- Canvas security and least-privilege reconciliation.

CREATE OR REPLACE FUNCTION public.canvas_documents_snapshot_and_prune()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.canvas_document_versions (document_id, document, created_by, created_at)
  VALUES (OLD.id, OLD.document, OLD.updated_by, OLD.updated_at);
  DELETE FROM public.canvas_document_versions
  WHERE id IN (
    SELECT id
    FROM public.canvas_document_versions
    WHERE document_id = OLD.id
    ORDER BY created_at DESC
    OFFSET 50
  );
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.canvas_documents_snapshot_and_prune() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.canvas_documents_preserve_created_by()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.created_by := OLD.created_by;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.canvas_documents_preserve_created_by() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.canvas_append_document_version(p_document_id uuid, p_document jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT public.is_active_user() THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;
  INSERT INTO public.canvas_document_versions (document_id, document, created_by, created_at)
  VALUES (p_document_id, p_document, auth.uid(), now())
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.canvas_documents_enforce_lww()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
  v_id uuid;
  v_name text;
  v_updated_at timestamptz;
  v_existing record;
BEGIN
  IF NOT public.is_active_user() THEN
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

CREATE OR REPLACE FUNCTION public.admin_set_admin(p_user_id uuid, p_is_admin boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admins integer;
BEGIN
  IF NOT public.is_admin() THEN
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

CREATE OR REPLACE FUNCTION public.admin_toggle_disabled(p_user_id uuid, p_disabled boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admins integer;
BEGIN
  IF NOT public.is_admin() THEN
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

REVOKE ALL ON TABLE public.canvas_documents, public.canvas_document_versions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.canvas_documents TO authenticated;
GRANT SELECT ON TABLE public.canvas_document_versions TO authenticated;
GRANT ALL ON TABLE public.canvas_documents, public.canvas_document_versions TO service_role;

REVOKE ALL ON FUNCTION public.canvas_append_document_version(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.canvas_append_document_version(uuid, jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.canvas_documents_enforce_lww() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.canvas_push_document_lww(jsonb, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.canvas_push_document_lww(jsonb, timestamptz) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_set_admin(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_admin(uuid, boolean) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_toggle_disabled(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_toggle_disabled(uuid, boolean) TO authenticated;

DROP POLICY IF EXISTS "canvas_realtime_receive" ON realtime.messages;
DROP POLICY IF EXISTS "canvas_realtime_send" ON realtime.messages;

CREATE POLICY "canvas_realtime_receive"
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  public.is_active_user()
  AND extension IN ('broadcast', 'presence')
  AND realtime.topic() LIKE 'canvas-document:%'
);

CREATE POLICY "canvas_realtime_send"
ON realtime.messages
FOR INSERT
TO authenticated
WITH CHECK (
  public.is_active_user()
  AND extension IN ('broadcast', 'presence')
  AND realtime.topic() LIKE 'canvas-document:%'
);

CREATE OR REPLACE FUNCTION public.admin_delete_user(p_user_id uuid)
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
  IF NOT public.is_admin() THEN
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

REVOKE ALL ON FUNCTION public.admin_delete_user(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_user(uuid) TO authenticated;
