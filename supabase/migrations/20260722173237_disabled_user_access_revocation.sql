-- Disabled users must keep SELECT on their own profile so clients can read
-- is_disabled and force logout. Migration 0010 gated own-row SELECT on
-- is_active_user(), which hid the flag and left disabled sessions usable.
DROP POLICY IF EXISTS "users_read_own_profile" ON public.user_profiles;
CREATE POLICY "users_read_own_profile"
  ON public.user_profiles
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- When an admin disables a user: ban auth login and revoke live sessions.
-- Re-enabling clears the ban so the user can sign in again.
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

  UPDATE public.user_profiles
  SET is_disabled = p_disabled, updated_at = now()
  WHERE user_id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Usuario no encontrado';
  END IF;

  IF p_disabled THEN
    UPDATE auth.users
    SET banned_until = '9999-12-31 23:59:59+00'::timestamptz
    WHERE id = p_user_id;

    DELETE FROM auth.sessions WHERE user_id = p_user_id;
    DELETE FROM auth.refresh_tokens WHERE user_id = p_user_id::text;
  ELSE
    UPDATE auth.users
    SET banned_until = NULL
    WHERE id = p_user_id;
  END IF;
END;
$$;

-- Push profile updates (incl. is_disabled) to connected clients.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'user_profiles'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.user_profiles;
  END IF;
END $$;

-- Backfill: users disabled before this migration must also be banned.
UPDATE auth.users u
SET banned_until = '9999-12-31 23:59:59+00'::timestamptz
FROM public.user_profiles p
WHERE p.user_id = u.id
  AND p.is_disabled = true
  AND (u.banned_until IS NULL OR u.banned_until < now());

DELETE FROM auth.sessions s
USING public.user_profiles p
WHERE p.user_id = s.user_id AND p.is_disabled = true;

DELETE FROM auth.refresh_tokens r
USING public.user_profiles p
WHERE p.user_id::text = r.user_id AND p.is_disabled = true;
