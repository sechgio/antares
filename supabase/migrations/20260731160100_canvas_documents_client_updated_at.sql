-- LWW on canvas_documents is client-clock driven: pushCanvasDocument sends
-- the author's updatedAt and the client compares it against the remote row.
-- Overriding updated_at with now() on every UPDATE mixed server and client
-- clocks, letting the server "win" spurious LWW battles. Client sends
-- updated_at on every upsert, so the defense-in-depth trigger is redundant.
DROP TRIGGER IF EXISTS canvas_documents_set_updated_at ON public.canvas_documents;
