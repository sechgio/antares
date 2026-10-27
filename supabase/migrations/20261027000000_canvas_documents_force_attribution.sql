-- F2 (auditoría 2026-10-27): el INSERT directo en canvas_documents permitía
-- fijar created_by y updated_by con cualquier UUID; el cliente solo mentiría
-- sobre la autoría, no sobre el acceso (la política sigue siendo el modelo
-- compartido, ver docs/adr/0004-modelo-de-datos-compartido.md). El RPC LWW ya
-- usa auth.uid(); este trigger fuerza lo mismo para cualquier INSERT con
-- sesión de usuario. Sin JWT (service_role, mantenimiento) no toca los valores.

CREATE OR REPLACE FUNCTION public.canvas_documents_force_attribution()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NOT NULL THEN
    NEW.created_by := v_uid;
    NEW.updated_by := v_uid;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.canvas_documents_force_attribution() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS canvas_documents_force_attribution ON public.canvas_documents;
CREATE TRIGGER canvas_documents_force_attribution
  BEFORE INSERT ON public.canvas_documents
  FOR EACH ROW EXECUTE FUNCTION public.canvas_documents_force_attribution();
