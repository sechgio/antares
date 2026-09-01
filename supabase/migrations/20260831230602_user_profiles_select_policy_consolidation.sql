-- Evaluate the own-row and admin branches once through a single policy.
DROP POLICY IF EXISTS "admins_read_all_profiles" ON public.user_profiles;
DROP POLICY IF EXISTS "users_read_own_profile" ON public.user_profiles;

CREATE POLICY "users_and_admins_read_profiles"
  ON public.user_profiles
  FOR SELECT
  TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR (SELECT public.is_admin())
  );
