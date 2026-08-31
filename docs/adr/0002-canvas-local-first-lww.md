# Canvas local-first con LWW por updatedAt

Contexto: Canvas es editor A4 (AGENTS.md Canvas Subsystem). Decidimos disco local (`%LOCALAPPDATA%/Antares/canvas/documents/<id>.json`, writes atómicos, RLock) como fuente de verdad; Supabase `canvas_documents` es espejo best-effort con Last-Writer-Wins por `updatedAt`, push fire-and-forget tras `canvas_save` y poll al recuperar foco. No hay colaboración tiempo-real.

Considered: CRDT/Yjs tiempo-real. Rechazado por complejidad y requisito offline-first; se re-evaluará si se pide edición simultánea (ver dirección D1).
