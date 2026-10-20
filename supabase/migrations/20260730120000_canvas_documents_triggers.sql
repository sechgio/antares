
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
