CREATE VIEW public.tareas_vencimientos
WITH (security_invoker = true)
AS
SELECT
  t.id,
  t.title,
  t.due_date,
  t.status,
  t.proyecto_id,
  p.name AS proyecto_name,
  e.id AS espacio_id,
  e.name AS espacio_name,
  t.assignee_id,
  COALESCE(c.is_done, t.status IN ('done', 'closed')) AS status_is_done
FROM public.tareas t
JOIN public.proyectos p ON p.id = t.proyecto_id
JOIN public.espacios e ON e.id = p.espacio_id
LEFT JOIN public.board_columns c ON c.proyecto_id = t.proyecto_id AND c.key = t.status;

REVOKE ALL ON TABLE public.tareas_vencimientos FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.tareas_vencimientos TO authenticated, service_role;
