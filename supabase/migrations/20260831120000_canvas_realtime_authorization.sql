-- Keep Canvas collaboration on private Realtime topics.
-- The current Canvas library is shared by every active authenticated user, so
-- document-level ACLs are intentionally not introduced by this migration.

DROP POLICY IF EXISTS "canvas_realtime_receive" ON realtime.messages;
DROP POLICY IF EXISTS "canvas_realtime_send" ON realtime.messages;

CREATE POLICY "canvas_realtime_receive"
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  public.is_active_user()
  AND extension IN ('broadcast', 'presence')
  AND realtime.topic() LIKE 'canvas-document:%'
);

CREATE POLICY "canvas_realtime_send"
ON realtime.messages
FOR INSERT
TO authenticated
WITH CHECK (
  public.is_active_user()
  AND extension IN ('broadcast', 'presence')
  AND realtime.topic() LIKE 'canvas-document:%'
);
