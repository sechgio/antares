-- Security remediation: Canvas search_path, RPC append, CORS helper notes, last-admin guard

-- Fix search_path on SECURITY DEFINER functions
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
    SELECT id FROM public.canvas_document_versions
    WHERE document_id = OLD.id
    ORDER BY created_at DESC
    OFFSET 50
  );
  RETURN NEW;
END;
$$;

-- canvas_documents_preserve_created_by is not SECURITY DEFINER but fix search_path anyway
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

-- RPC for version append: replaces direct INSERT from clients
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

REVOKE ALL ON FUNCTION public.canvas_append_document_version(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.canvas_append_document_version(uuid, jsonb) TO authenticated;

-- Revoke direct INSERT for clients; they must use the RPC. Keep SELECT.
REVOKE INSERT ON public.canvas_document_versions FROM authenticated;
-- Ensure RLS still allows SELECT via existing policy; INSERT now only via SECURITY DEFINER RPC

-- Harden admin functions: lock rows and prevent last-admin removal/disable
CREATE OR REPLACE FUNCTION public.admin_set_admin(p_user_id uuid, p_is_admin boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admins int;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Solo los administradores pueden cambiar roles';
  END IF;
  IF p_user_id = auth.uid() AND NOT p_is_admin THEN
    RAISE EXCEPTION 'No puedes quitarte el rol de administrador a ti mismo';
  END IF;
  -- Lock relevant rows to prevent concurrent last-admin race
  PERFORM 1 FROM public.user_profiles WHERE user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Usuario no encontrado';
  END IF;
  IF NOT p_is_admin THEN
    -- Count active admins (locked)
    SELECT count(*) INTO v_admins FROM public.user_profiles WHERE is_admin = true AND COALESCE(is_disabled,false)=false FOR UPDATE;
    -- If target is an active admin and we'd drop to zero, block
    IF EXISTS (SELECT 1 FROM public.user_profiles WHERE user_id=p_user_id AND is_admin=true AND COALESCE(is_disabled,false)=false) THEN
      IF v_admins <= 1 THEN
        RAISE EXCEPTION 'No se puede degradar al último administrador activo';
      END IF;
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
  v_admins int;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Solo los administradores pueden deshabilitar usuarios';
  END IF;
  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'No puedes desactivar tu propia cuenta';
  END IF;
  PERFORM 1 FROM public.user_profiles WHERE user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Usuario no encontrado';
  END IF;
  IF p_disabled THEN
    -- Prevent disabling the last active admin
    SELECT count(*) INTO v_admins FROM public.user_profiles WHERE is_admin = true AND COALESCE(is_disabled,false)=false FOR UPDATE;
    IF EXISTS (SELECT 1 FROM public.user_profiles WHERE user_id=p_user_id AND is_admin=true AND COALESCE(is_disabled,false)=false) THEN
      IF v_admins <= 1 THEN
        RAISE EXCEPTION 'No se puede deshabilitar al último administrador activo';
      END IF;
    END IF;
  END IF;
  UPDATE public.user_profiles SET is_disabled = p_disabled WHERE user_id = p_user_id;
  IF p_disabled THEN
    UPDATE auth.users SET banned_until = '9999-12-31 23:59:59+00' WHERE id = p_user_id;
    DELETE FROM auth.sessions WHERE user_id = p_user_id;
    DELETE FROM auth.refresh_tokens WHERE user_id = p_user_id::text;
  ELSE
    UPDATE auth.users SET banned_until = NULL WHERE id = p_user_id;
  END IF;
END;
$$;
