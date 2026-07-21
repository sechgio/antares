-- Phase 5: invite-only hardening

-- 1. is_admin() must also reject disabled accounts
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT is_admin AND NOT COALESCE(is_disabled, false)
      FROM public.user_profiles
      WHERE user_id = auth.uid()
    ),
    false
  );
$$;

-- 2. Prevent deletion of system board columns
CREATE OR REPLACE FUNCTION public.board_columns_prevent_system_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.is_system THEN
    RAISE EXCEPTION 'No se pueden eliminar columnas del sistema';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS board_columns_prevent_system_delete ON public.board_columns;
CREATE TRIGGER board_columns_prevent_system_delete
  BEFORE DELETE ON public.board_columns
  FOR EACH ROW EXECUTE FUNCTION public.board_columns_prevent_system_delete();

-- 3. Force created_by from auth.uid() on insert (espacios, tareas)
CREATE OR REPLACE FUNCTION public.set_created_by()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    NEW.created_by := auth.uid();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS espacios_set_created_by ON public.espacios;
CREATE TRIGGER espacios_set_created_by
  BEFORE INSERT ON public.espacios
  FOR EACH ROW EXECUTE FUNCTION public.set_created_by();

DROP TRIGGER IF EXISTS tareas_set_created_by ON public.tareas;
CREATE TRIGGER tareas_set_created_by
  BEFORE INSERT ON public.tareas
  FOR EACH ROW EXECUTE FUNCTION public.set_created_by();

-- 4. Restrict admin RPCs to authenticated role only
REVOKE EXECUTE ON FUNCTION public.admin_list_users() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_toggle_disabled(uuid, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_set_admin(uuid, boolean) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.admin_list_users() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_toggle_disabled(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_admin(uuid, boolean) TO authenticated;

-- 5. seed_default_board_columns: only active users may seed
CREATE OR REPLACE FUNCTION public.seed_default_board_columns(p_proyecto_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuario no autorizado';
  END IF;

  INSERT INTO public.board_columns (proyecto_id, key, name, color, sort_order, is_done, is_system)
  VALUES
    (p_proyecto_id, 'todo', 'Pendiente', '#87909E', 0, false, true),
    (p_proyecto_id, 'in_progress', 'En curso', '#5F55EE', 1, false, true),
    (p_proyecto_id, 'done', 'Completados', '#0F9D58', 2, true, true),
    (p_proyecto_id, 'urgent', 'Urgente', '#EF4444', 3, false, true),
    (p_proyecto_id, 'closed', 'Cerrada', '#64748B', 4, true, true)
  ON CONFLICT (proyecto_id, key) DO NOTHING;
END;
$$;

-- 6. team_list_members: email not shown in assignee picker UI
DROP FUNCTION IF EXISTS public.team_list_members();
CREATE OR REPLACE FUNCTION public.team_list_members()
RETURNS TABLE (
  user_id uuid,
  display_name text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    u.id AS user_id,
    COALESCE(p.display_name, split_part(u.email, '@', 1)) AS display_name
  FROM auth.users u
  LEFT JOIN public.user_profiles p ON p.user_id = u.id
  WHERE COALESCE(p.is_disabled, false) = false
    AND public.is_active_user();
$$;
