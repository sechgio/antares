-- Audit hardening: shrink unused API surface without changing app behavior.
-- App uses: auth, user_profiles, espacios, proyectos, tareas, board_columns,
-- RPCs admin_*, team_list_members, seed_default_board_columns, and realtime
-- on those tables (+ user_profiles). GraphQL/Storage/vistas are unused.

-- 1) Table grants: revoke broad defaults (esp. anon), re-grant only what PostgREST needs.
REVOKE ALL ON TABLE
  public.user_profiles,
  public.espacios,
  public.proyectos,
  public.tareas,
  public.vistas,
  public.board_columns
FROM PUBLIC, anon, authenticated;

GRANT SELECT, UPDATE ON TABLE public.user_profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.espacios TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.proyectos TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.tareas TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.board_columns TO authenticated;
-- vistas: unused by the app — no grants to API roles

GRANT ALL ON TABLE
  public.user_profiles,
  public.espacios,
  public.proyectos,
  public.tareas,
  public.vistas,
  public.board_columns
TO service_role;

-- 2) Function EXECUTE: drop default PUBLIC/anon exposure, grant only intentional RPCs + RLS helpers.
REVOKE EXECUTE ON FUNCTION public.admin_list_users() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_set_admin(uuid, boolean) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_toggle_disabled(uuid, boolean) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.team_list_members() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.seed_default_board_columns(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_active_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_seed_board_columns_on_proyecto() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_created_by() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.board_columns_prevent_system_delete() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.user_profiles_guard_privilege_columns() FROM PUBLIC, anon, authenticated;

-- Intentional client RPCs
GRANT EXECUTE ON FUNCTION public.admin_list_users() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_admin(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_toggle_disabled(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.team_list_members() TO authenticated;
GRANT EXECUTE ON FUNCTION public.seed_default_board_columns(uuid) TO authenticated;

-- RLS helpers (policies call these as the requesting role)
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_active_user() TO authenticated;

-- 3) Fix mutable search_path on trigger helpers (advisor WARN).
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_created_by()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    NEW.created_by := auth.uid();
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.board_columns_prevent_system_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.is_system THEN
    RAISE EXCEPTION 'No se pueden eliminar columnas del sistema';
  END IF;
  RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION public.user_profiles_guard_privilege_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
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

-- 4) RLS initplan: evaluate auth.uid() once per statement.
DROP POLICY IF EXISTS "users_read_own_profile" ON public.user_profiles;
CREATE POLICY "users_read_own_profile"
  ON public.user_profiles
  FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "users_update_own_profile" ON public.user_profiles;
CREATE POLICY "users_update_own_profile"
  ON public.user_profiles
  FOR UPDATE
  TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

-- 5) Dead realtime surface: vistas is never subscribed by the app.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'vistas'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.vistas;
  END IF;
END $$;
