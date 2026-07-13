-- Bloquear UPDATE directo de is_admin / is_disabled por usuarios no admin.
-- display_name y updated_at siguen permitidos via users_update_own_profile.
-- admin_set_admin / admin_toggle_disabled (SECURITY DEFINER) siguen funcionando.

CREATE OR REPLACE FUNCTION public.user_profiles_guard_privilege_columns()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (NEW.is_admin IS DISTINCT FROM OLD.is_admin)
     OR (NEW.is_disabled IS DISTINCT FROM OLD.is_disabled) THEN
    IF NOT public.is_admin() THEN
      RAISE EXCEPTION 'Solo los administradores pueden modificar roles o el estado de la cuenta';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS user_profiles_guard_privilege_columns ON public.user_profiles;
CREATE TRIGGER user_profiles_guard_privilege_columns
  BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.user_profiles_guard_privilege_columns();
