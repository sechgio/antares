-- Fix access revocation for deleted users.
-- Previously, private.is_active_user() used:
--   SELECT auth.uid() IS NOT NULL AND NOT COALESCE((SELECT is_disabled FROM public.user_profiles WHERE user_id = auth.uid()), false);
-- If the user was deleted, the user_profiles row was gone, so the subquery returned NULL,
-- COALESCE(NULL, false) became false, and NOT false became true, granting deleted users access.
-- We require that the user actually EXISTS in public.user_profiles with is_disabled = false.

CREATE OR REPLACE FUNCTION private.is_active_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_profiles
    WHERE user_id = auth.uid()
      AND is_disabled = false
  );
$$;

ALTER TABLE public.user_profiles REPLICA IDENTITY FULL;

-- Ensure admin_delete_user cleans up sessions and refresh tokens before deleting auth.users
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

  DELETE FROM auth.sessions WHERE user_id = p_user_id;
  DELETE FROM auth.refresh_tokens WHERE user_id = p_user_id::text;
  DELETE FROM auth.users WHERE id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Usuario no encontrado';
  END IF;
END;
$$;
