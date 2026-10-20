
DROP POLICY IF EXISTS "authenticated_read_profiles" ON public.user_profiles;

DROP POLICY IF EXISTS "users_read_own_profile" ON public.user_profiles;
CREATE POLICY "users_read_own_profile"
  ON public.user_profiles
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() AND public.is_active_user());
