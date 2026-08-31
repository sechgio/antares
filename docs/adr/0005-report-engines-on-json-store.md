# Motores de reportes paralelos sobre JsonDocumentStore

Mantenemos 6 dominios de reportes (`technical_reports`, `informes_v2`, `fichas_tecnicas`, `padron`, `volantes`, `evidencia_volanteo`) con shape `database.py`+`importer.py`+`rendering.py` duplicado. Persistencia ya unificada en `backend/core/json_store.py:JsonDocumentStore` (threshold 0.11.10). Importers/renderers siguen divergentes por plantilla (AGENTS.md Project Structure).

Decisión: no abstraer aún el pipeline de importer/rendering; el coste de generalización supera el ahorro mientras las plantillas sigan divergiendo. Re-evaluar al añadir el 7º reporte.
