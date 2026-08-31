# Schema Canvas espejado FE/BE sin fuente compartida (estado actual)

`DOCUMENT_VERSION=2` y 22 `CanvasLayerType` viven en `frontend/src/components/canvas/types.ts` y `backend/core/canvas/types.py`+`models.py` sin fuente compartida (AGENTS.md Schema). `normalize_document` re-valida en carga; FE hace upgrade v1→v2, BE re-stampa versión. `meta` por tipo se valida por key-sniffing (`_normalize_meta`). Layer `pageIndex` clamp en ambos lados.

Consecuencia: drift silencioso posible; `tests/test_canvas_schema_parity.py` mitiga. Futuro: fuente única (codegen o JSON schema compartido) — ver auditoría hallazgo #2.
