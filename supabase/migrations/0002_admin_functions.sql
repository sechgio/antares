CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT is_admin FROM public.user_profiles WHERE user_id = auth.uid()),
    false
  );
$$;

DROP POLICY IF EXISTS "admins_read_all_profiles" ON public.user_profiles;
CREATE POLICY "admins_read_all_profiles"
  ON public.user_profiles
  FOR SELECT
  USING (public.is_admin());

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
  WHERE public.is_admin();
$$;

CREATE OR REPLACE FUNCTION public.admin_toggle_disabled(p_user_id uuid, p_disabled boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Solo los administradores pueden desactivar usuarios';
  END IF;
  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'No puedes desactivar tu propia cuenta';
  END IF;
  UPDATE public.user_profiles SET is_disabled = p_disabled, updated_at = now()
  WHERE user_id = p_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_admin(p_user_id uuid, p_is_admin boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Solo los administradores pueden cambiar roles';
  END IF;
  IF p_user_id = auth.uid() AND NOT p_is_admin THEN
    RAISE EXCEPTION 'No puedes quitarte el rol de admin a ti mismo';
  END IF;
  UPDATE public.user_profiles SET is_admin = p_is_admin, updated_at = now()
  WHERE user_id = p_user_id;
END;
$$;
