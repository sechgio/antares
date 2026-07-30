-- Defense-in-depth for canvas_documents:
-- 1. set_updated_at: auto-stamp updated_at on UPDATE so any code path that
--    forgets to set it cannot break LWW cloud sync.
-- 2. preserve_created_by: never let an UPDATE overwrite created_by — the
--    original creator is immutable even if app code sends a stale value.

DROP TRIGGER IF EXISTS canvas_documents_set_updated_at ON public.canvas_documents;
CREATE TRIGGER canvas_documents_set_updated_at
  BEFORE UPDATE ON public.canvas_documents
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.canvas_documents_preserve_created_by()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.created_by = OLD.created_by;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS canvas_documents_preserve_created_by ON public.canvas_documents;
CREATE TRIGGER canvas_documents_preserve_created_by
  BEFORE UPDATE ON public.canvas_documents
  FOR EACH ROW EXECUTE FUNCTION public.canvas_documents_preserve_created_by();

REVOKE EXECUTE ON FUNCTION public.canvas_documents_preserve_created_by() FROM PUBLIC, anon, authenticated;
