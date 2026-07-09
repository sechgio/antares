-- Board columns (tableros/columnas Kanban) por proyecto.
-- Defaults del sistema: Pendiente, En curso, Completados, Urgente (+ Cerrada).
-- Permite columnas personalizadas; tareas.status deja de estar limitado a un CHECK fijo.

CREATE TABLE IF NOT EXISTS public.board_columns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proyecto_id uuid NOT NULL REFERENCES public.proyectos(id) ON DELETE CASCADE,
  key text NOT NULL,
  name text NOT NULL,
  color text NOT NULL DEFAULT '#87909E',
  sort_order double precision NOT NULL DEFAULT 0,
  is_done boolean NOT NULL DEFAULT false,
  is_system boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT board_columns_proyecto_key_unique UNIQUE (proyecto_id, key),
  CONSTRAINT board_columns_key_not_blank CHECK (length(trim(key)) > 0),
  CONSTRAINT board_columns_name_not_blank CHECK (length(trim(name)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_board_columns_proyecto ON public.board_columns(proyecto_id);

DROP TRIGGER IF EXISTS board_columns_set_updated_at ON public.board_columns;
CREATE TRIGGER board_columns_set_updated_at
  BEFORE UPDATE ON public.board_columns
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Status libre (debe coincidir con board_columns.key del proyecto)
ALTER TABLE public.tareas DROP CONSTRAINT IF EXISTS tareas_status_check;

-- Seed de columnas por defecto para un proyecto
CREATE OR REPLACE FUNCTION public.seed_default_board_columns(p_proyecto_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
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

CREATE OR REPLACE FUNCTION public.trg_seed_board_columns_on_proyecto()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.seed_default_board_columns(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS proyectos_seed_board_columns ON public.proyectos;
CREATE TRIGGER proyectos_seed_board_columns
  AFTER INSERT ON public.proyectos
  FOR EACH ROW EXECUTE FUNCTION public.trg_seed_board_columns_on_proyecto();

-- Backfill proyectos existentes
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT id FROM public.proyectos LOOP
    PERFORM public.seed_default_board_columns(r.id);
  END LOOP;
END $$;

-- RLS
ALTER TABLE public.board_columns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "board_columns_active_users_all" ON public.board_columns;
CREATE POLICY "board_columns_active_users_all"
  ON public.board_columns
  FOR ALL
  TO authenticated
  USING (public.is_active_user())
  WITH CHECK (public.is_active_user());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.board_columns TO authenticated;
GRANT ALL ON public.board_columns TO service_role;
GRANT EXECUTE ON FUNCTION public.seed_default_board_columns(uuid) TO authenticated;

-- Realtime
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'board_columns'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.board_columns;
  END IF;
END $$;
