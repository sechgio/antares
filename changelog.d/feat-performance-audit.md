### Changed

- Se reduce el trabajo al volver a listar las habilidades locales y al consultar el índice de documentos Canvas.

### Fixed

- Las importaciones del catálogo son ~1.3-1.5× más rápidas al eliminar índices redundantes que no cubrían las búsquedas reales.
- El backend ya no importa pandas, openpyxl, pymupdf, docx ni weasyprint a los 8 s de cada arranque: se calientan bajo demanda en el primer trabajo pesado, ahorrando ~1.3 s de CPU por sesión cuando no se usan conversiones ni exportaciones.
- La telemetría IPC deja de recorrer íntegros los payloads grandes (documentos Canvas) gracias a un presupuesto de nodos en la estimación.
- La carga de Supabase se difiere a tiempo de inactividad y el barrido de imágenes de Canvas se agrupa en ráfagas de edición, reduciendo el trabajo en el arranque y durante la edición.
