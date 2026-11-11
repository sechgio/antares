-- sb-004 (extension de sb-001/M9): los canales realtime privados del canvas
-- quedan atados al documento concreto del topic, no a «cualquier topic del
-- canvas». Sin esto, cualquier usuario autenticado escuchaba presencia de
-- cualquier documento y podía emitir un document_saved falso que aplastaba
-- el pull legítimo (pendingRealtimeTimestampRef en useCanvasSync.ts).
--
-- Modelo vigente (20261110120000): Lecturas de equipo; escritura del canvas
-- solo por su creador o un administrador. Por tanto:
--  - RECEIVE (SELECT sobre realtime.messages): usuario activo y el documento
--    del topic existe (no publicado/borrado). Presencia solo entre quienes
--    ya pueden leer el documento.
--  - SEND para el evento document_saved: creador del documento o admin, la
--    misma autoridad que el guardado por RPC. Los broadcast de eventos no
--    reconocidos quedan denegados (deny-by-default): hoy el único evento que
--    publica el canvas es document_saved.

DROP POLICY IF EXISTS "canvas_realtime_receive" ON realtime.messages;
DROP POLICY IF EXISTS "canvas_realtime_send" ON realtime.messages;
DROP POLICY IF EXISTS "canvas_realtime_document_saved_send" ON realtime.messages;

CREATE POLICY "canvas_realtime_receive"
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  (SELECT private.is_active_user())
  AND extension IN ('broadcast', 'presence')
  AND realtime.topic() ~ '^canvas-document:[0-9a-fA-F-]{36}$'
  AND EXISTS (
    SELECT 1
    FROM public.canvas_documents AS documento
    WHERE documento.id = (substring(realtime.topic() from 17))::uuid
  )
);

-- Presencia y broadcast generico: mismo criterio de lectura (el emisor debe
-- poder ver el documento cuya presencia anuncia).
CREATE POLICY "canvas_realtime_send"
ON realtime.messages
FOR INSERT
TO authenticated
WITH CHECK (
  (SELECT private.is_active_user())
  AND extension = 'presence'
  AND realtime.topic() ~ '^canvas-document:[0-9a-fA-F-]{36}$'
  AND EXISTS (
    SELECT 1
    FROM public.canvas_documents AS documento
    WHERE documento.id = (substring(realtime.topic() from 17))::uuid
  )
);

-- document_saved: la notificación de guardado exige la autoridad de escritura
-- del documento (creador o admin), idéntica a canvas_push_document_lww_v2.
CREATE POLICY "canvas_realtime_document_saved_send"
ON realtime.messages
FOR INSERT
TO authenticated
WITH CHECK (
  (SELECT private.is_active_user())
  AND extension = 'broadcast'
  AND event = 'document_saved'
  AND realtime.topic() ~ '^canvas-document:[0-9a-fA-F-]{36}$'
  AND EXISTS (
    SELECT 1
    FROM public.canvas_documents AS documento
    WHERE documento.id = (substring(realtime.topic() from 17))::uuid
      AND (
        documento.created_by = (SELECT auth.uid())
        OR (SELECT private.is_admin())
      )
  )
);
