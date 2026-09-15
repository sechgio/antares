BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.no_plan();

SELECT extensions.has_table('public', 'tarea_comments', 'tarea_comments existe');
SELECT extensions.has_table('public', 'tarea_activity', 'tarea_activity existe');
SELECT extensions.has_view('public', 'mis_tareas', 'mis_tareas existe');
SELECT extensions.has_index('public', 'tarea_comments', 'idx_tarea_comments_tarea_created', 'comentarios tienen índice de timeline');
SELECT extensions.has_index('public', 'tarea_activity', 'idx_tarea_activity_tarea_created', 'actividad tiene índice de timeline');
SELECT extensions.is(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.tarea_comments'::regclass),
  true,
  'comentarios tiene RLS'
);
SELECT extensions.is(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.tarea_activity'::regclass),
  true,
  'actividad tiene RLS'
);
SELECT extensions.is(
  has_function_privilege('authenticated', 'private.record_tarea_activity()', 'EXECUTE'),
  false,
  'authenticated no puede invocar el trigger privilegiado'
);
SELECT extensions.ok(
  'security_invoker=true' = ANY (
    SELECT unnest(reloptions) FROM pg_class WHERE oid = 'public.mis_tareas'::regclass
  ),
  'mis_tareas usa security_invoker'
);

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('10000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'uno@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('10000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'dos@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('10000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'disabled@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('10000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'deleted@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

UPDATE public.user_profiles
SET display_name = CASE user_id
  WHEN '10000000-0000-0000-0000-000000000001'::uuid THEN 'Enzo'
  WHEN '10000000-0000-0000-0000-000000000002'::uuid THEN 'María'
  WHEN '10000000-0000-0000-0000-000000000004'::uuid THEN 'Persona temporal'
  ELSE 'Deshabilitado'
END,
is_disabled = user_id = '10000000-0000-0000-0000-000000000003'::uuid;

INSERT INTO public.espacios (id, name, created_by)
VALUES ('20000000-0000-0000-0000-000000000001', 'Informes', '10000000-0000-0000-0000-000000000001');
INSERT INTO public.proyectos (id, espacio_id, name)
VALUES ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Sedapal Norte');
INSERT INTO public.tareas (
  id, proyecto_id, title, status, priority, assignee_id, created_by
) VALUES (
  '40000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001',
  'Revisar informe', 'todo', 'normal',
  '10000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001'
);

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);

SELECT extensions.lives_ok(
  $$INSERT INTO public.tarea_comments (id, tarea_id, author_id, body)
    VALUES (
      '50000000-0000-0000-0000-000000000001',
      '40000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000002',
      '  Falta revisar las fotografías.  '
    )$$,
  'usuario activo puede comentar una tarea accesible'
);
SELECT extensions.is(
  (SELECT author_id FROM public.tarea_comments WHERE id = '50000000-0000-0000-0000-000000000001'),
  '10000000-0000-0000-0000-000000000001'::uuid,
  'el trigger impide suplantar al autor'
);
SELECT extensions.is(
  (SELECT body FROM public.tarea_comments WHERE id = '50000000-0000-0000-0000-000000000001'),
  'Falta revisar las fotografías.',
  'el comentario se persiste recortado'
);
SELECT extensions.throws_ok(
  $$INSERT INTO public.tarea_comments (tarea_id, author_id, body)
    VALUES (
      '40000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000001',
      '   '
    )$$,
  '23514',
  NULL,
  'la base rechaza comentarios vacíos'
);
SELECT extensions.lives_ok(
  $$UPDATE public.tarea_comments SET body = 'Corregido' WHERE id = '50000000-0000-0000-0000-000000000001'$$,
  'el autor puede actualizar su comentario'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM public.tarea_activity
   WHERE tarea_id = '40000000-0000-0000-0000-000000000001' AND event_type = 'comment_created'),
  1,
  'crear comentario registra actividad una sola vez'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated"}',
  true
);
UPDATE public.tarea_comments
SET body = 'Intento ajeno'
WHERE id = '50000000-0000-0000-0000-000000000001';
SELECT extensions.is(
  (SELECT body FROM public.tarea_comments WHERE id = '50000000-0000-0000-0000-000000000001'),
  'Corregido',
  'otro usuario activo no puede actualizar el comentario del autor'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);

SELECT extensions.lives_ok(
  $$UPDATE public.tareas SET
      status = 'in_progress',
      priority = 'urgent',
      assignee_id = '10000000-0000-0000-0000-000000000002',
      start_date = '2026-09-15',
      due_date = '2026-09-20',
      title = 'Revisar informe actualizado',
      description = 'Revisar evidencia'
    WHERE id = '40000000-0000-0000-0000-000000000001'$$,
  'cambiar campos auditables actualiza la tarea'
);
SELECT extensions.results_eq(
  $$SELECT field_name FROM public.tarea_activity
    WHERE tarea_id = '40000000-0000-0000-0000-000000000001'
      AND event_type = 'field_changed'
    ORDER BY field_name$$,
  $$VALUES ('assignee_id'::text), ('description'::text), ('due_date'::text), ('priority'::text), ('start_date'::text), ('status'::text), ('title'::text)$$,
  'los siete campos auditables generan eventos separados'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM public.tarea_activity
   WHERE tarea_id = '40000000-0000-0000-0000-000000000001' AND event_type = 'field_changed'),
  7,
  'solo los campos realmente modificados generan actividad'
);
SELECT extensions.is(
  (SELECT old_value FROM public.tarea_activity
   WHERE tarea_id = '40000000-0000-0000-0000-000000000001' AND field_name = 'status'),
  '"todo"'::jsonb,
  'actividad conserva el estado anterior como valor escalar'
);
SELECT extensions.is(
  (SELECT new_value FROM public.tarea_activity
   WHERE tarea_id = '40000000-0000-0000-0000-000000000001' AND field_name = 'priority'),
  '"urgent"'::jsonb,
  'actividad conserva la prioridad nueva como valor escalar'
);
UPDATE public.tareas SET updated_at = now() WHERE id = '40000000-0000-0000-0000-000000000001';
SELECT extensions.is(
  (SELECT count(*)::integer FROM public.tarea_activity
   WHERE tarea_id = '40000000-0000-0000-0000-000000000001' AND event_type = 'field_changed'),
  7,
  'updated_at no genera actividad inútil'
);
SELECT extensions.throws_ok(
  $$INSERT INTO public.tarea_activity (tarea_id, actor_id, event_type)
    VALUES (
      '40000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000001',
      'task_created'
    )$$,
  '42501',
  NULL,
  'el cliente no puede manipular actividad'
);

INSERT INTO public.tareas (
  id, proyecto_id, title, status, priority, assignee_id, created_by
) VALUES (
  '40000000-0000-0000-0000-000000000002',
  '30000000-0000-0000-0000-000000000001',
  'Mi tarea', 'todo', 'high',
  '10000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001'
);
SELECT extensions.results_eq(
  $$SELECT id FROM public.mis_tareas ORDER BY id$$,
  $$VALUES ('40000000-0000-0000-0000-000000000002'::uuid)$$,
  'mis_tareas devuelve solo tareas asignadas a auth.uid()'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM public.tarea_activity
   WHERE tarea_id = '40000000-0000-0000-0000-000000000002' AND event_type = 'task_created'),
  1,
  'crear una tarea registra actividad'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-0000-0000-000000000003","role":"authenticated"}',
  true
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM public.tarea_comments),
  0,
  'usuario deshabilitado no lee comentarios'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM public.tarea_activity),
  0,
  'usuario deshabilitado no lee actividad'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM public.mis_tareas),
  0,
  'usuario deshabilitado no lee la vista global'
);
SELECT extensions.throws_ok(
  $$INSERT INTO public.tarea_comments (tarea_id, author_id, body)
    VALUES (
      '40000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000003',
      'No permitido'
    )$$,
  '42501',
  NULL,
  'usuario deshabilitado no escribe comentarios'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-0000-0000-000000000004","role":"authenticated"}',
  true
);
INSERT INTO public.tarea_comments (id, tarea_id, author_id, body)
VALUES (
  '50000000-0000-0000-0000-000000000004',
  '40000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000004',
  'Comentario que debe sobrevivir'
);

RESET ROLE;
DELETE FROM auth.users WHERE id = '10000000-0000-0000-0000-000000000004';
SELECT extensions.is(
  (SELECT author_id FROM public.tarea_comments WHERE id = '50000000-0000-0000-0000-000000000004'),
  NULL::uuid,
  'borrar usuario conserva el comentario y anula la FK'
);
SELECT extensions.is(
  (SELECT author_name FROM public.tarea_comments WHERE id = '50000000-0000-0000-0000-000000000004'),
  'Persona temporal',
  'el comentario conserva una etiqueta legible del autor eliminado'
);
SELECT extensions.is(
  (SELECT actor_id FROM public.tarea_activity
   WHERE new_value = jsonb_build_object('comment_id', '50000000-0000-0000-0000-000000000004'::uuid)),
  NULL::uuid,
  'la actividad sobrevive al borrado del actor'
);

DELETE FROM public.tareas WHERE id = '40000000-0000-0000-0000-000000000001';
SELECT extensions.is(
  (SELECT count(*)::integer FROM public.tarea_comments WHERE tarea_id = '40000000-0000-0000-0000-000000000001'),
  0,
  'borrar tarea elimina sus comentarios'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM public.tarea_activity WHERE tarea_id = '40000000-0000-0000-0000-000000000001'),
  0,
  'borrar tarea elimina su actividad'
);

SELECT * FROM extensions.finish();
ROLLBACK;
