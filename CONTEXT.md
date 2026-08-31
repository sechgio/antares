# Antares — Lenguaje Ubicuo

Vocabulario canónico del dominio. Usar estos términos en código, tests y ADRs; evitar sinónimos listados en _Avoid_.

## Canvas

**Canvas Document**: Documento A4 paginado editable (capas, páginas, guides) persistido en `%LOCALAPPDATA%/Antares/canvas/documents/<id>.json` con `DOCUMENT_VERSION`.
_Avoid_: Board, Design, File

**Layer**: Elemento adressable en el document tree con `id`, `type` (22 tipos) y `meta` por tipo.
_Avoid_: Node, Object, Shape (genérico)

**Artboard**: Superficie de gesto que traduce pointer events a `onPreviewLayers`/`onCommitGesture`.
_Avoid_: Canvas (genérico), Stage

**Page**: Hoja A4 (210×297mm) dentro del document; `pageIndex` clamp al rango válido.
_Avoid_: Sheet, Slide

**Guide**: Regla de alineación persistida por documento (`CanvasGuide`), no una capa.
_Avoid_: Ruler, Grid line

## Procesamiento

**Conversión**: Transformación batch de imágenes (JPEG/PNG/WebP/BMP/TIFF/GIF/ICO→formato destino) con cola IPC heavy.
_Avoid_: Convert, Export (genérico)

**Renombrado**: Asignación de nombre destino por `RenamePlan` (Excel mapping `ID→RENOMBRE` o patrón dinámico SQLite).
_Avoid_: Rename masivo, Bulk rename

**Formato**: Plantilla PDF base64 en `formatos/` + estrategia (`legacy_xobject`, `visual_overlay`) aplicada por `format_registry`.
_Avoid_: Template (cuando refiere a formato base)

**Mapeo**: Tabla `ID→RENOMBRE` resuelta por `ResolveStrategy` y validada por `column rename` hooks.
_Avoid_: Mapping genérico, Diccionario

## Reportes

**Padrón / Volante / Informe Técnico / Ficha Técnica**: Dominios de reporte con CRUD local + importer Excel + rendering WeasyPrint.
_Avoid_: Report (genérico), Documento

**Sellador**: Inserción de sello/firma/folio sobre PDF base sin re-render.
_Avoid_: Stamper, Watermark

**Evidencia Volanteo**: Reporte fotográfico con layout `rendering.py` y paginación por ubicación.
_Avoid_: Volante, Evidencia (solo)

**Ubicaciones**: Herramienta de georeferenciado que genera `preview_ubicacion` vía static-map fetch (OSM/Google) y compose.
_Avoid_: Mapa, Location tool

## Infra

**IPC lane**: Clasificación `light`/`heavy`/`canvas`/`sync` que determina el pool de `WorkScheduler`.
_Avoid_: Queue, Thread

**Source of truth**: Para Canvas, el JSON en disco; cloud Supabase es espejo best-effort LWW por `updatedAt`.
_Avoid_: Master, Primary (ambiguo)

**Espacios**: Módulo colaborativo con Supabase Realtime (distinto de Canvas que es local-first sin realtime).
_Avoid_: Workspace (genérico), Project

**AutoIMG**: Pipeline Drive/Sheets que sincroniza carpetas, autentica vía Google OAuth y renombra por `BdImgTable`.
_Avoid_: Auto Imagen, Drive sync (genérico)
