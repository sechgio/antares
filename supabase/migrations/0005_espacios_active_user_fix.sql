
CREATE OR REPLACE FUNCTION public.is_active_user()
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

INSERT INTO public.user_profiles (user_id, display_name)
SELECT
  u.id,
  split_part(u.email, '@', 1)
FROM auth.users u
WHERE NOT EXISTS (
  SELECT 1 FROM public.user_profiles p WHERE p.user_id = u.id
);
