-- Invariantes anti-takeover en escrituras colaborativas.
-- Las políticas DELETE dependen de created_by/espacio_id; esos campos no pueden ser reasignados por el cliente.

CREATE OR REPLACE FUNCTION public.espacios_preserve_created_by()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.created_by := OLD.created_by;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS espacios_preserve_created_by ON public.espacios;
CREATE TRIGGER espacios_preserve_created_by
  BEFORE UPDATE ON public.espacios
  FOR EACH ROW EXECUTE FUNCTION public.espacios_preserve_created_by();

CREATE OR REPLACE FUNCTION public.tareas_preserve_created_by()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.created_by := OLD.created_by;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tareas_preserve_created_by ON public.tareas;
CREATE TRIGGER tareas_preserve_created_by
  BEFORE UPDATE ON public.tareas
  FOR EACH ROW EXECUTE FUNCTION public.tareas_preserve_created_by();

CREATE OR REPLACE FUNCTION public.proyectos_guard_espacio_move()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  old_owner uuid;
  new_owner uuid;
BEGIN
  IF NEW.espacio_id IS NOT DISTINCT FROM OLD.espacio_id THEN
    RETURN NEW;
  END IF;
  IF public.is_admin() THEN
    RETURN NEW;
  END IF;
  SELECT created_by INTO old_owner FROM public.espacios WHERE id = OLD.espacio_id;
  SELECT created_by INTO new_owner FROM public.espacios WHERE id = NEW.espacio_id;
  IF auth.uid() IS NOT NULL AND auth.uid() = old_owner AND auth.uid() = new_owner THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Solo el propietario de ambos espacios o un administrador puede mover el proyecto';
END;
$$;

DROP TRIGGER IF EXISTS proyectos_guard_espacio_move ON public.proyectos;
CREATE TRIGGER proyectos_guard_espacio_move
  BEFORE UPDATE ON public.proyectos
  FOR EACH ROW EXECUTE FUNCTION public.proyectos_guard_espacio_move();

REVOKE ALL ON FUNCTION public.espacios_preserve_created_by() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tareas_preserve_created_by() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.proyectos_guard_espacio_move() FROM PUBLIC, anon, authenticated;

-- Las escrituras directas siguen la misma ventana de sesgo horario que el RPC LWW.
-- La atribución de INSERT ya existía; UPDATE también debe reestampar updated_by
-- cuando hay JWT. Sin sesión (service_role/mantenimiento) se conservan los valores.
CREATE OR REPLACE FUNCTION public.canvas_documents_force_attribution()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
BEGIN
  IF NEW.updated_at > pg_catalog.clock_timestamp() + INTERVAL '5 minutes' THEN
    RAISE EXCEPTION 'La marca de tiempo del documento Canvas está en el futuro';
  END IF;

  v_uid := auth.uid();
  IF v_uid IS NOT NULL THEN
    IF TG_OP = 'INSERT' THEN
      NEW.created_by := v_uid;
    END IF;
    NEW.updated_by := v_uid;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS canvas_documents_force_attribution ON public.canvas_documents;
CREATE TRIGGER canvas_documents_force_attribution
  BEFORE INSERT OR UPDATE ON public.canvas_documents
  FOR EACH ROW EXECUTE FUNCTION public.canvas_documents_force_attribution();

-- Un cliente no puede crear columnas de sistema. current_user distingue el INSERT
-- directo de authenticated del seed SECURITY DEFINER y de service_role.
CREATE OR REPLACE FUNCTION public.board_columns_force_client_columns_non_system()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.is_system AND current_user = 'authenticated' THEN
    NEW.is_system := false;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.board_columns_force_client_columns_non_system() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS board_columns_force_client_columns_non_system ON public.board_columns;
CREATE TRIGGER board_columns_force_client_columns_non_system
  BEFORE INSERT OR UPDATE ON public.board_columns
  FOR EACH ROW EXECUTE FUNCTION public.board_columns_force_client_columns_non_system();

-- Conserva la autorización de sb-003 y restaura la poda/deduplicación centralizada.
CREATE OR REPLACE FUNCTION private.canvas_append_document_version(p_document_id uuid, p_document jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, pg_temp
AS $$
DECLARE
  v_owner uuid;
  v_created_at timestamptz;
BEGIN
  IF NOT private.is_active_user() THEN
    RAISE EXCEPTION 'Usuario no autorizado';
  END IF;
  IF p_document_id IS NULL THEN
    RAISE EXCEPTION 'El documento Canvas requiere un id';
  END IF;

  PERFORM private.canvas_assert_document_within_limit(p_document);

  SELECT created_by
    INTO v_owner
    FROM public.canvas_documents
   WHERE id = p_document_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El documento Canvas no existe';
  END IF;
  IF v_owner IS DISTINCT FROM auth.uid() AND NOT private.is_admin() THEN
    RAISE EXCEPTION 'Solo el creador del documento o un administrador puede añadir versiones';
  END IF;

  v_created_at := COALESCE(NULLIF(p_document->>'updatedAt', '')::timestamptz, now());
  RETURN private.canvas_record_document_version(
    p_document_id,
    p_document,
    auth.uid(),
    v_created_at
  );
END;
$$;
