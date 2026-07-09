-- ESPACIOS: espacios, proyectos, tareas y vistas (equipo compartido)

CREATE TABLE IF NOT EXISTS public.espacios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  color text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.proyectos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  espacio_id uuid NOT NULL REFERENCES public.espacios(id) ON DELETE CASCADE,
  name text NOT NULL,
  is_favorite boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.tareas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proyecto_id uuid NOT NULL REFERENCES public.proyectos(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'todo'
    CHECK (status IN ('todo', 'in_progress', 'done', 'urgent', 'closed')),
  assignee_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  start_date date,
  due_date date,
  sort_order double precision NOT NULL DEFAULT 0,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.vistas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proyecto_id uuid NOT NULL REFERENCES public.proyectos(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('list', 'board', 'calendar', 'gantt')),
  name text NOT NULL,
  config_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  sort_order double precision NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_proyectos_espacio ON public.proyectos(espacio_id);
CREATE INDEX IF NOT EXISTS idx_tareas_proyecto ON public.tareas(proyecto_id);
CREATE INDEX IF NOT EXISTS idx_tareas_due_date ON public.tareas(due_date);
CREATE INDEX IF NOT EXISTS idx_tareas_assignee ON public.tareas(assignee_id);
CREATE INDEX IF NOT EXISTS idx_vistas_proyecto ON public.vistas(proyecto_id);

-- updated_at triggers
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS espacios_set_updated_at ON public.espacios;
CREATE TRIGGER espacios_set_updated_at
  BEFORE UPDATE ON public.espacios
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS proyectos_set_updated_at ON public.proyectos;
CREATE TRIGGER proyectos_set_updated_at
  BEFORE UPDATE ON public.proyectos
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS tareas_set_updated_at ON public.tareas;
CREATE TRIGGER tareas_set_updated_at
  BEFORE UPDATE ON public.tareas
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS vistas_set_updated_at ON public.vistas;
CREATE TRIGGER vistas_set_updated_at
  BEFORE UPDATE ON public.vistas
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Helper: usuario activo (no deshabilitado)
CREATE OR REPLACE FUNCTION public.is_active_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT NOT is_disabled FROM public.user_profiles WHERE user_id = auth.uid()),
    false
  );
$$;

-- Lista miembros del equipo (display_name para assignee picker)
CREATE OR REPLACE FUNCTION public.team_list_members()
RETURNS TABLE (
  user_id uuid,
  display_name text,
  email text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    u.id AS user_id,
    COALESCE(p.display_name, split_part(u.email, '@', 1)) AS display_name,
    u.email
  FROM auth.users u
  LEFT JOIN public.user_profiles p ON p.user_id = u.id
  WHERE COALESCE(p.is_disabled, false) = false
    AND public.is_active_user();
$$;

GRANT EXECUTE ON FUNCTION public.team_list_members() TO authenticated;

-- RLS
ALTER TABLE public.espacios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proyectos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tareas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vistas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "espacios_active_users_all"
  ON public.espacios
  FOR ALL
  TO authenticated
  USING (public.is_active_user())
  WITH CHECK (public.is_active_user());

CREATE POLICY "proyectos_active_users_all"
  ON public.proyectos
  FOR ALL
  TO authenticated
  USING (public.is_active_user())
  WITH CHECK (public.is_active_user());

CREATE POLICY "tareas_active_users_all"
  ON public.tareas
  FOR ALL
  TO authenticated
  USING (public.is_active_user())
  WITH CHECK (public.is_active_user());

CREATE POLICY "vistas_active_users_all"
  ON public.vistas
  FOR ALL
  TO authenticated
  USING (public.is_active_user())
  WITH CHECK (public.is_active_user());

-- Perfiles: lectura para picker de assignee
DROP POLICY IF EXISTS "authenticated_read_profiles" ON public.user_profiles;
CREATE POLICY "authenticated_read_profiles"
  ON public.user_profiles
  FOR SELECT
  TO authenticated
  USING (public.is_active_user());

-- PostgREST: exponer tablas a roles de API
GRANT SELECT, INSERT, UPDATE, DELETE ON public.espacios TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.proyectos TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tareas TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vistas TO authenticated;
GRANT ALL ON public.espacios TO service_role;
GRANT ALL ON public.proyectos TO service_role;
GRANT ALL ON public.tareas TO service_role;
GRANT ALL ON public.vistas TO service_role;

-- Realtime (idempotente)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'espacios'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.espacios;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'proyectos'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.proyectos;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'tareas'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.tareas;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'vistas'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.vistas;
  END IF;
END $$;
