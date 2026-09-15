CREATE TABLE public.tarea_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tarea_id uuid NOT NULL REFERENCES public.tareas(id) ON DELETE CASCADE,
  author_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  author_name text NOT NULL CHECK (length(btrim(author_name)) > 0),
  body text NOT NULL CHECK (length(btrim(body)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.tarea_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tarea_id uuid NOT NULL REFERENCES public.tareas(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_name text,
  event_type text NOT NULL CHECK (event_type IN ('task_created', 'field_changed', 'comment_created')),
  field_name text CHECK (
    field_name IS NULL OR field_name IN (
      'title', 'description', 'status', 'priority', 'assignee_id', 'start_date', 'due_date'
    )
  ),
  old_value jsonb,
  new_value jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_tarea_comments_tarea_created
  ON public.tarea_comments (tarea_id, created_at, id);
CREATE INDEX idx_tarea_activity_tarea_created
  ON public.tarea_activity (tarea_id, created_at, id);

ALTER TABLE public.tarea_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tarea_activity ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.tarea_comments FROM anon, authenticated;
REVOKE ALL ON TABLE public.tarea_activity FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.tarea_comments TO authenticated;
GRANT SELECT ON TABLE public.tarea_activity TO authenticated;
GRANT ALL ON TABLE public.tarea_comments, public.tarea_activity TO service_role;

CREATE POLICY "tarea_comments_select_accessible_task"
  ON public.tarea_comments FOR SELECT TO authenticated
  USING (
    (SELECT private.is_active_user())
    AND EXISTS (SELECT 1 FROM public.tareas t WHERE t.id = tarea_comments.tarea_id)
  );

CREATE POLICY "tarea_comments_insert_accessible_task"
  ON public.tarea_comments FOR INSERT TO authenticated
  WITH CHECK (
    author_id = (SELECT auth.uid())
    AND (SELECT private.is_active_user())
    AND EXISTS (SELECT 1 FROM public.tareas t WHERE t.id = tarea_comments.tarea_id)
  );

CREATE POLICY "tarea_comments_update_author"
  ON public.tarea_comments FOR UPDATE TO authenticated
  USING (
    author_id = (SELECT auth.uid())
    AND (SELECT private.is_active_user())
    AND EXISTS (SELECT 1 FROM public.tareas t WHERE t.id = tarea_comments.tarea_id)
  )
  WITH CHECK (
    author_id = (SELECT auth.uid())
    AND (SELECT private.is_active_user())
    AND EXISTS (SELECT 1 FROM public.tareas t WHERE t.id = tarea_comments.tarea_id)
  );

CREATE POLICY "tarea_comments_delete_author"
  ON public.tarea_comments FOR DELETE TO authenticated
  USING (
    author_id = (SELECT auth.uid())
    AND (SELECT private.is_active_user())
    AND EXISTS (SELECT 1 FROM public.tareas t WHERE t.id = tarea_comments.tarea_id)
  );

CREATE POLICY "tarea_activity_select_accessible_task"
  ON public.tarea_activity FOR SELECT TO authenticated
  USING (
    (SELECT private.is_active_user())
    AND EXISTS (SELECT 1 FROM public.tareas t WHERE t.id = tarea_activity.tarea_id)
  );

CREATE OR REPLACE FUNCTION private.prepare_tarea_comment()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  NEW.body := btrim(NEW.body);
  IF TG_OP = 'INSERT' THEN
    IF auth.uid() IS NOT NULL THEN
      NEW.author_id := auth.uid();
      SELECT NULLIF(btrim(display_name), '') INTO NEW.author_name
      FROM public.user_profiles
      WHERE user_id = auth.uid();
    END IF;
    NEW.author_name := COALESCE(NULLIF(btrim(NEW.author_name), ''), 'Usuario');
    NEW.created_at := now();
    NEW.updated_at := NEW.created_at;
  ELSE
    NEW.tarea_id := OLD.tarea_id;
    -- Preserve client ownership changes, but allow the FK's ON DELETE SET NULL
    -- action to detach an author without deleting the conversation.
    IF NEW.author_id IS NOT NULL THEN
      NEW.author_id := OLD.author_id;
    END IF;
    NEW.author_name := OLD.author_name;
    NEW.created_at := OLD.created_at;
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.prepare_tarea_comment() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER tarea_comments_prepare
  BEFORE INSERT OR UPDATE ON public.tarea_comments
  FOR EACH ROW EXECUTE FUNCTION private.prepare_tarea_comment();

CREATE OR REPLACE FUNCTION private.record_tarea_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_actor_name text;
BEGIN
  IF COALESCE(
       NULLIF(current_setting('request.jwt.claim.role', true), ''),
       NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
     ) = 'authenticated'
     AND v_actor IS NULL THEN
    RAISE EXCEPTION 'Usuario autenticado sin identidad válida';
  END IF;

  SELECT NULLIF(btrim(display_name), '') INTO v_actor_name
  FROM public.user_profiles
  WHERE user_id = COALESCE(v_actor, NEW.created_by);

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.tarea_activity (tarea_id, actor_id, actor_name, event_type, new_value)
    VALUES (
      NEW.id,
      COALESCE(v_actor, NEW.created_by),
      COALESCE(v_actor_name, 'Usuario'),
      'task_created',
      jsonb_build_object('title', NEW.title)
    );
    RETURN NEW;
  END IF;

  IF OLD.title IS DISTINCT FROM NEW.title THEN
    INSERT INTO public.tarea_activity (tarea_id, actor_id, actor_name, event_type, field_name, old_value, new_value)
    VALUES (NEW.id, v_actor, COALESCE(v_actor_name, 'Usuario'), 'field_changed', 'title', to_jsonb(OLD.title), to_jsonb(NEW.title));
  END IF;
  IF OLD.description IS DISTINCT FROM NEW.description THEN
    INSERT INTO public.tarea_activity (tarea_id, actor_id, actor_name, event_type, field_name, old_value, new_value)
    VALUES (NEW.id, v_actor, COALESCE(v_actor_name, 'Usuario'), 'field_changed', 'description', to_jsonb(OLD.description), to_jsonb(NEW.description));
  END IF;
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO public.tarea_activity (tarea_id, actor_id, actor_name, event_type, field_name, old_value, new_value)
    VALUES (NEW.id, v_actor, COALESCE(v_actor_name, 'Usuario'), 'field_changed', 'status', to_jsonb(OLD.status), to_jsonb(NEW.status));
  END IF;
  IF OLD.priority IS DISTINCT FROM NEW.priority THEN
    INSERT INTO public.tarea_activity (tarea_id, actor_id, actor_name, event_type, field_name, old_value, new_value)
    VALUES (NEW.id, v_actor, COALESCE(v_actor_name, 'Usuario'), 'field_changed', 'priority', to_jsonb(OLD.priority), to_jsonb(NEW.priority));
  END IF;
  IF OLD.assignee_id IS DISTINCT FROM NEW.assignee_id THEN
    INSERT INTO public.tarea_activity (tarea_id, actor_id, actor_name, event_type, field_name, old_value, new_value)
    VALUES (NEW.id, v_actor, COALESCE(v_actor_name, 'Usuario'), 'field_changed', 'assignee_id', to_jsonb(OLD.assignee_id), to_jsonb(NEW.assignee_id));
  END IF;
  IF OLD.start_date IS DISTINCT FROM NEW.start_date THEN
    INSERT INTO public.tarea_activity (tarea_id, actor_id, actor_name, event_type, field_name, old_value, new_value)
    VALUES (NEW.id, v_actor, COALESCE(v_actor_name, 'Usuario'), 'field_changed', 'start_date', to_jsonb(OLD.start_date), to_jsonb(NEW.start_date));
  END IF;
  IF OLD.due_date IS DISTINCT FROM NEW.due_date THEN
    INSERT INTO public.tarea_activity (tarea_id, actor_id, actor_name, event_type, field_name, old_value, new_value)
    VALUES (NEW.id, v_actor, COALESCE(v_actor_name, 'Usuario'), 'field_changed', 'due_date', to_jsonb(OLD.due_date), to_jsonb(NEW.due_date));
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.record_tarea_activity() FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION private.record_tarea_activity() IS
  'SECURITY DEFINER is required so an audited tareas write can append to client-read-only tarea_activity. The function is private, not client-executable, and records only auth.uid plus allowlisted scalar fields.';

CREATE TRIGGER tareas_record_activity
  AFTER INSERT OR UPDATE ON public.tareas
  FOR EACH ROW EXECUTE FUNCTION private.record_tarea_activity();

CREATE OR REPLACE FUNCTION private.record_tarea_comment_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF COALESCE(
       NULLIF(current_setting('request.jwt.claim.role', true), ''),
       NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
     ) = 'authenticated'
     AND (auth.uid() IS NULL OR NEW.author_id IS DISTINCT FROM auth.uid()) THEN
    RAISE EXCEPTION 'Autor de comentario no válido';
  END IF;

  INSERT INTO public.tarea_activity (tarea_id, actor_id, actor_name, event_type, new_value)
  VALUES (NEW.tarea_id, NEW.author_id, NEW.author_name, 'comment_created', jsonb_build_object('comment_id', NEW.id));
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.record_tarea_comment_activity() FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION private.record_tarea_comment_activity() IS
  'SECURITY DEFINER is required so an authorized comment insert can append to client-read-only tarea_activity. The function is private and not client-executable.';

CREATE TRIGGER tarea_comments_record_activity
  AFTER INSERT ON public.tarea_comments
  FOR EACH ROW EXECUTE FUNCTION private.record_tarea_comment_activity();

CREATE VIEW public.mis_tareas
WITH (security_invoker = true)
AS
SELECT
  t.id,
  t.proyecto_id,
  t.title,
  t.description,
  t.status,
  t.priority,
  t.assignee_id,
  t.start_date,
  t.due_date,
  t.sort_order,
  t.created_by,
  t.created_at,
  t.updated_at,
  p.name AS proyecto_name,
  e.id AS espacio_id,
  e.name AS espacio_name,
  COALESCE(c.name, t.status) AS status_name,
  COALESCE(c.is_done, t.status IN ('done', 'closed')) AS status_is_done
FROM public.tareas t
JOIN public.proyectos p ON p.id = t.proyecto_id
JOIN public.espacios e ON e.id = p.espacio_id
LEFT JOIN public.board_columns c ON c.proyecto_id = t.proyecto_id AND c.key = t.status
WHERE t.assignee_id = (SELECT auth.uid());

REVOKE ALL ON TABLE public.mis_tareas FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.mis_tareas TO authenticated, service_role;

CREATE VIEW public.mis_tareas_origenes
WITH (security_invoker = true)
AS
SELECT DISTINCT
  proyecto_id,
  proyecto_name,
  espacio_id,
  espacio_name
FROM public.mis_tareas;

REVOKE ALL ON TABLE public.mis_tareas_origenes FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.mis_tareas_origenes TO authenticated, service_role;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'tarea_comments'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.tarea_comments;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'tarea_activity'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.tarea_activity;
  END IF;
END $$;
