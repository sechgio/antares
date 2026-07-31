-- Canvas docs are a shared library: client DELETE would let any active user
-- hard-delete the whole library. The app only soft-deletes (deleted_at).
REVOKE DELETE ON public.canvas_documents FROM authenticated;

DROP POLICY IF EXISTS "canvas_documents_active_users_all" ON public.canvas_documents;
DROP POLICY IF EXISTS "canvas_documents_active_users_modify" ON public.canvas_documents;

CREATE POLICY "canvas_documents_active_users_select"
  ON public.canvas_documents
  FOR SELECT
  TO authenticated
  USING (public.is_active_user());

CREATE POLICY "canvas_documents_active_users_insert"
  ON public.canvas_documents
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_active_user());

CREATE POLICY "canvas_documents_active_users_update"
  ON public.canvas_documents
  FOR UPDATE
  TO authenticated
  USING (public.is_active_user())
  WITH CHECK (public.is_active_user());

-- DELETE stays reserved for service_role (already granted via GRANT ALL).
