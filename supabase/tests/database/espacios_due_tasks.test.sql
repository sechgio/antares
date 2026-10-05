BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.no_plan();

SELECT extensions.has_view('public', 'tareas_vencimientos', 'tareas_vencimientos existe');
SELECT extensions.ok(
  'security_invoker=true' = ANY (
    SELECT unnest(reloptions) FROM pg_class WHERE oid = 'public.tareas_vencimientos'::regclass
  ),
  'la vista respeta RLS del usuario que consulta'
);
SELECT extensions.ok(
  NOT has_table_privilege('anon', 'public.tareas_vencimientos', 'SELECT'),
  'anon no puede consultar vencimientos'
);
SELECT extensions.ok(
  has_table_privilege('service_role', 'public.tareas_vencimientos', 'SELECT'),
  'service_role puede consultar vencimientos'
);

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('11000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'vencimientos@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('11000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'vencimientos-disabled@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now());
UPDATE public.user_profiles
SET is_disabled = true
WHERE user_id = '11000000-0000-0000-0000-000000000002';

INSERT INTO public.espacios (id, name, created_by)
VALUES ('21000000-0000-0000-0000-000000000001', 'Vencimientos', '11000000-0000-0000-0000-000000000001');
INSERT INTO public.proyectos (id, espacio_id, name) VALUES
  ('31000000-0000-0000-0000-000000000001', '21000000-0000-0000-0000-000000000001', 'Campaña'),
  ('31000000-0000-0000-0000-000000000002', '21000000-0000-0000-0000-000000000001', 'Otro proyecto');
INSERT INTO public.board_columns (proyecto_id, key, name, is_done) VALUES
  ('31000000-0000-0000-0000-000000000001', 'entregado', 'Entregado', true),
  ('31000000-0000-0000-0000-000000000001', 'revision', 'En revisión', false),
  ('31000000-0000-0000-0000-000000000002', 'revision', 'Revisión terminada', true);

INSERT INTO public.tareas (proyecto_id, title, status, due_date, created_by)
SELECT '31000000-0000-0000-0000-000000000001', 'Completada ' || n, 'done', '2026-01-01'::date,
       '11000000-0000-0000-0000-000000000001'
FROM generate_series(1, 80) n;
INSERT INTO public.tareas (proyecto_id, title, status, due_date, assignee_id, created_by) VALUES
  ('31000000-0000-0000-0000-000000000001', 'Pendiente', 'todo', '2026-02-01', '11000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000001'),
  ('31000000-0000-0000-0000-000000000001', 'Revisar', 'revision', '2026-02-02', '11000000-0000-0000-0000-000000000002', '11000000-0000-0000-0000-000000000001'),
  ('31000000-0000-0000-0000-000000000001', 'Sin columna', 'sin_columna', '2026-02-03', NULL, '11000000-0000-0000-0000-000000000001'),
  ('31000000-0000-0000-0000-000000000001', 'Entregada', 'entregado', '2026-01-02', NULL, '11000000-0000-0000-0000-000000000001'),
  ('31000000-0000-0000-0000-000000000001', 'Cerrada', 'closed', '2026-01-03', NULL, '11000000-0000-0000-0000-000000000001');

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"11000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
SELECT extensions.results_eq(
  $$SELECT title FROM public.tareas_vencimientos
    WHERE proyecto_id = '31000000-0000-0000-0000-000000000001' AND status_is_done = false
    ORDER BY due_date, id LIMIT 2 OFFSET 0$$,
  $$VALUES ('Pendiente'::text), ('Revisar'::text)$$,
  'filtrar antes de paginar devuelve abiertas tras 80 completadas y respeta el proyecto de la columna'
);
SELECT extensions.results_eq(
  $$SELECT title FROM public.tareas_vencimientos
    WHERE proyecto_id = '31000000-0000-0000-0000-000000000001' AND status_is_done = false
    ORDER BY due_date, id LIMIT 2 OFFSET 2$$,
  $$VALUES ('Sin columna'::text)$$,
  'la segunda página incluye estados sin columna con fallback abierto'
);
SELECT extensions.results_eq(
  $$SELECT title FROM public.tareas_vencimientos
    WHERE proyecto_id = '31000000-0000-0000-0000-000000000001'
      AND status_is_done = false AND assignee_id = auth.uid()$$,
  $$VALUES ('Pendiente'::text)$$,
  'el consumidor puede filtrar mis vencimientos sin limitar la vista al responsable'
);
SELECT extensions.is(
  (SELECT status_is_done FROM public.tareas_vencimientos WHERE title = 'Entregada'
   AND proyecto_id = '31000000-0000-0000-0000-000000000001'),
  true,
  'is_done de una columna personalizada determina si la tarea está terminada'
);
SELECT extensions.is(
  (SELECT status_is_done FROM public.tareas_vencimientos WHERE title = 'Cerrada'
   AND proyecto_id = '31000000-0000-0000-0000-000000000001'),
  true,
  'cerradas quedan excluidas de las tareas abiertas'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"11000000-0000-0000-0000-000000000002","role":"authenticated"}',
  true
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM public.tareas_vencimientos),
  0,
  'usuarios deshabilitados no leen vencimientos mediante la vista'
);

RESET ROLE;
SELECT * FROM extensions.finish();
ROLLBACK;
