# Changelog

Todas las versiones notables de Antares se documentan aquí.

Formato basado en [Keep a Changelog](https://keepachangelog.com/),
y este proyecto sigue [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- **Backend / telemetría**: con `ANTARES_IPC_TELEMETRY=1`, cada request IPC emite una línea `ipc_phase` con `msg_id`, lane, latencias por fase (`parse`/`scheduler_wait`/`handler`/`serialize_write`) y snapshots/deltas RSS; fallos de telemetría no afectan el pipe.

### Changed
- **Formatos / preview**: `max_width` ahora limita el raster sin alterar la respuesta PNG ni los previews de Sellador. En 30 muestras warm comparables a 1200 px, p95 bajó de 62,5 a 37,7 ms (-39,7%) y el delta RSS pico de 13,6 a 6,1 MiB (-55,2%).
- **Panel aviso / WeasyPrint**: `write_pdf_sanitized` reutiliza un `FontConfiguration` por hilo (sin singleton global ni lock). En el rebenchmark IPC completo (93 métodos; “Primera” excluida de percentiles; n=30 heavy), `panel_aviso_corte_render_pdf` bajó de p50 168,8 / p95 297,3 ms a p50 112,7 / p95 168,7 ms (-43,3% p95). Microbench A/B de `write_pdf_sanitized`: p95 75,4 → 52,3 ms (-30,6%).
- **PDF HTML / LRU**: `write_pdf_sanitized` cachea hasta 2 PDFs por `sha256` del HTML sanitizado (máx. 8 MiB/entrada; sanitización y deny-by-default intactos). Contra el baseline fresco del líder (p50 99,2 / p95 122,1 ms, n=30), `panel_aviso_corte_render_pdf` quedó en p50 0,93 / p95 1,50 ms (-98,8% p95) con payload idéntico repetido; confirmación en 2 lotes dentro de ±15%.

### Fixed
- **Backend / IPC**: `ready` se emite una sola vez justo antes del lector stdin (tras `warm_core`, plugins opcionales y scheduler). `warm_deferred` sigue opt-in con `ANTARES_WARM_DEFERRED=1` para no inflar el RSS base; elimina la ventana en que Electron veía `ready` antes de que el bucle IPC estuviera listo.
- **Backend / memoria**: `send_response`/`send_notification` codifican UTF-8 una sola vez y escriben por `stdout.buffer`; jobs completados retienen solo el allowlist de `process_status` (`file_count`/`destino`/`formato`).

## [0.11.5] — 2026-08-04

### Added
- **Informes v2**: Nuevo módulo con CRUD local, importación desde plantilla Excel, matching de fotos/logos, preview en UI y generación PDF (individual y consolidado).

### Changed
- **Informes técnicos**: Título actualizado a Centro de Servicio Villa El Salvador (dos líneas) en vista previa y plantilla de exportación.
- **Conversión**: Skip de `exif_transpose` cuando Orientation falta o es 1 (~40% más rápido en JPEG verticales).
- **Canvas**: Memo de LayerNode corregido; preservación de blob tras save; coalescencia de pushes cloud por documento.
- **Backend**: Warm solo de handlers core antes de ready; diferimiento de sellador/ubicaciones/fichas hasta después del handshake.

## [0.11.4] — 2026-08-03

### Fixed
- **IPC**: Endurecimiento de manejo de solicitudes IPC — preservación del tamaño completo para líneas IPC sobredimensionadas y recuperación ante solicitudes oversize.
- **IPC**: Validación de entradas IPC con códigos de error estructurados.
- **Persistencia**: Escrituras de archivos destructivos atomizadas para prevenir corrupción.
- **Persistencia**: Preservación de bases de datos JSON corruptas en lugar de descartarlas (fichas técnicas, reportes técnicos, panel aviso corte).
- **Canvas**: Corrección de solapamiento del header del panel derecho.

### Security
- **IPC**: Endurecimiento general del transporte IPC entre Electron y backend (backend, router, main).

### Tests
- Cobertura de recuperación ante solicitudes IPC oversize, validación IPC, persistencia de bases de datos corruptas, y cierre de proceso IPC.

## [0.11.3] — 2026-07-30

### Added
- **Canvas Editor**: Selector de fuentes de Google Fonts estilo Figma con previsualización WYSIWYG en canvas y exportación PDF.
- **Canvas Editor**: Controles tipográficos avanzados estilo Figma (tamaño, peso, interlineado, espaciado de caracteres, alineación y transformación).
- **Canvas Editor**: Sistema de estilos compartidos (estilos de texto y color reutilizables en panel derecho).
- **Canvas Editor**: Guías de alineación y snap con escala constante independiente del nivel de zoom.

### Changed
- **Canvas Editor**: Composiciones de layout A4 mejoradas y ordenamiento de capas refinado.
- **Canvas Editor**: Optimización de rendimiento en arrastre de artboard y cálculo de snap guides.
- **Supabase**: URL dinámica de Supabase en Edge Functions para consistencia multi-entorno.

### Fixed
- **Canvas Editor**: Preservación del marco de rejilla al redimensionar artboards y aislamiento de variables CSS en estilos compartidos.
- **Canvas Editor**: Preservación de `created_by` y corrección del índice de página en sincronización cloud.
- **Canvas Editor**: Endurecimiento de operaciones de página, guardas de grupo, `parentId` huérfanos y triggers de base de datos.
- **Canvas Editor**: Edición de nombre de capas inline pulido en el panel de Capas.
- **Tests**: Corrección del test de coalescencia de `localThumb` con tick de microtask en la suite de integración.

## [0.11.2] — 2026-07-25

### Added
- **Canvas Editor**: Paridad Figma completa con herramienta de línea vectorial (editor de paths, remates de línea, curvar/cortar/lazo), grosor de trazo libre con slider e inserción de último estilo usado.
- **Canvas Editor**: Panel de Capas jerárquico con soporte para operaciones de capas conscientes del contenedor (agrupar, desagrupar, z-index).
- **Canvas Editor**: Auto-grow en vivo para edición de texto inline, soporte type-to-edit, auto-height y coalescencia de undo en modificaciones continuas de propiedades.
- **Reportes Técnicos**: Secciones colapsables y cabecera minimalista compacta para maximizar área de trabajo.
- **Arquitectura / UI**: Root `ErrorBoundary` global, virtualización de listas pesadas, códigos de error IPC estructurados y modularización de `UbicacionesView`.

### Changed
- **Canvas Editor**: Menú contextual pulido, conmutadores y tooltips de barra de herramientas alineados a Figma.
- **Performance**: Eliminación de transferencias base64 redundantes en previews de Ubicaciones y ejecución de `ANALYZE` optimizado tras importación de catálogo.

### Fixed
- **Canvas / Accesibilidad**: Solucionado acceso a Canvas, dependencias circulares, atajos de teclado y renderizado de previsualización/exportación alineado con el artboard de diseño.
- **Canvas Sync**: Corrección de bug de resurrección de capas eliminadas, propagación clara de errores y caracterización con suite de tests.
- **Seguridad**: Revocación inmediata de sesión cuando administradores deshabilitan usuarios y endurecimiento general de IPC en Electron, backend, frontend y Supabase.
- **Clean Code**: Eliminación de código muerto (métodos IPC no utilizados, tipos obsoletos y módulos sin consumo).

## [0.11.1] — 2026-07-16

### Added
- **Layout**: Sidebar con navegación agrupada, iconos Lucide unificados y tooltips al colapsar.
- **Padrón**: Controles de folio con estilo de página, tamaño y tipografía; `FolioMenuSelect` y footer de acciones pulido.
- **Preview panel**: `TemplatePicker` para elegir plantilla y mapping más claro.
- **Image Optimizer**: UI preview-first con chrome más calmado y drop stage.
- **UI**: componente `HoverTooltip` / `WithHoverTooltip` y `separator` (shadcn) reutilizables.
- **Tests**: cobertura de Sidebar, TitleBar, folio, TemplatePicker y theme coverage.

### Changed
- **Chrome general**: vistas densas estilo Apple en Espacios, AutoIMG, Volantes, Reportes de campo, Fichas técnicas, Reportes técnicos y Settings.
- **Appearance**: colores de tema aplicados de forma consistente a diálogos y chrome de módulos (incl. Vanta Black).
- **BrandMark**: tamaño de logo reducido para alinear mejor con la title bar.
- **Fichas técnicas**: panel de base de datos y editor más compactos; sin efectos de humo en el panel.
- **Padrón**: formularios, date picker y estilos de vista previa refinados.

### Fixed
- **Conversion / IPC**: ola de corrección 001–014 (cancelación, process death, re-sync, overwrite seguro, mapping stem conflicts, preview stale races).
- **Reportes técnicos**: slots de logo izquierdo y derecho restaurados.
- **A11y / tests**: nombres accesibles (`aria-label`) tras el paso a HoverTooltip (Eliminar, Recargar catálogo).
- **Process runner / Electron**: bookkeeping de UI y restart de backend más robustos.

### Removed
- Código muerto, dependencias sin uso, assets huérfanos y planes advisor 001–014 ya completados.
- Config local de tooling (`.factory`, `docs/superpowers`) fuera del tracking del repo.

## [0.10.20] — 2026-07-13

### Added
- **AutoIMG**: Chrome de cobertura compacto junto a acciones de escaneo; rediseño del tab Carpetas; previews de hasta 4 thumbnails de Drive por carpeta (sin escaneo completo).
- **Volantes**: Título y encabezados editables a nivel de sesión; sidebar más denso estilo Apple; date/time pickers con portales anclados exclusivos (sin recorte ni solapamiento).
- **Historial**: Tipo de run `ficha_tecnica` registrado para reejecución y listado.
- **Brand / UI**: Nuevo set de iconos de app y favicons con cache-busting; favicons dinámicos claro/oscuro según el tema del sistema.
- **Conversión**: Thumbnails a tamaño de display vía IPC nativo Electron (`local_thumbnail` / `nativeImage`), con LRU(200), concurrencia 3 y fallback a full-res/`file://`.
- **Backend (fiabilidad)**: Olas improve 007–017 — job complete siempre en error, `process_start` en light lane, payloads `process_status` reducidos, writes atómicos de config JSON, pymupdf en PyInstaller, cap de payload IPC inbound, paridad preview/process en `key_column` vacío, sanitize WeasyPrint unificado y stats de orphans O(1) en mapping.
- **Tests**: Paridad key-column preview/process, plugins/formatos characterization, IPC params faltantes, health-probe mid-flight en `npm test`, redaction de URLs de mapas, sanitize PDF HTML y portable out-path dedupe en Linux CI.

### Changed
- **Conversión**: Single-flight en rename preview (debounce 600ms + cola in-flight); metadata `detected_key_column` en preview evita un segundo IPC de detect; coalescing de `preview_image` (debounce 450ms, generation guard, single-flight).
- **Sellador**: Preview raster acotado (DPI MIN 900 / MAX 2048, dpr cap) y caches LRU max 32 (`otherPagesRenderCache`, `PdfPagePreview`).
- **Espacios**: Lazy-load de la vista calendario.
- **Historial**: Parse de JSON de run una sola vez por fila.
- **AutoIMG**: Cache LRU de previews de carpetas.
- **Deps**: Pillow elevado a `>=12.3.0`.
- **Docs**: Auth, env setup y alcance de módulos documentados.

### Fixed
- **Backend / conversión**: Heartbeats de job para que el health probe no mate conversiones largas; health probe responde `version`/`process_status` en el hilo IPC; budget de auto-restart acotado antes de FATAL; trabajo pesado de fichas/evidencia en el heavy pool.
- **Frontend / process runner**: Bookkeeping de UI endurecido (merges seed-safe, honor `{ started: false }`, reset en restarting/fatal/error).
- **Conversión**: Sin sobrescritura silenciosa al colisionar nombres de salida (sufijo `-2`, `-3`…); orientación EXIF aplicada antes de convert/preview.
- **Historial**: Reejecutar desde cualquier pestaña restaura destino, secuencia, `word_separator` y modo de secuencia.
- **UI**: Respuestas obsoletas de match/select ignoradas bajo navegación rápida (panel, reportes técnicos, fichas).
- **AutoIMG**: Bootstrap y verify de Drive ignoran respuestas stale; bootstrap como método long-running (timeout 15m); agregar carpetas Drive sin verify previo; sync de escaneo solo actualiza filas del padrón BD_IMG (no inserta NIS nuevos); fixes de tipos en `PreviewState` y tests de Carpetas.
- **Espacios**: Soft-delete no resucita tareas durante la ventana de undo; undo acotado al proyecto activo; notificaciones de vencimiento con Supabase realtime (menos polling).
- **Evidencia Volanteo**: Export Word alineado al preview (gutter grid, bordes de celda, altura de fila `atLeast` para cuadrante largo).
- **Reportes de campo**: Persistencia de todos los campos y logos al cambiar de pestaña (flush IndexedDB + branding store).
- **Padrón**: Folios únicos consecutivos entre hojas; `Hasta` sincronizado a `Desde+pages-1` (sin duplicados con offset/inversión).

### Security
- **Ubicaciones**: API keys de mapas (Google/Mapbox/MapTiler) en almacenamiento cifrado de Electron; migración única desde `localStorage` y borrado del plaintext residual.
- **Evidencia**: HTML sanitizado antes de WeasyPrint.
- **Logs**: Redacción de API keys de mapas en URLs.
- **IPC**: Cap de tamaño en payloads inbound.
- **Auth / Supabase**: Columnas de privilegio en `user_profiles` protegidas por trigger; revoke de token Google vía body POST.
- **PDF**: Sanitize de paths en todos los renders WeasyPrint.

## [0.10.19] — 2026-07-08

### Added
- **Fichas Técnicas**: nueva herramienta (backend, plantillas, UI e IPC) para generación de fichas técnicas.
- **Espacios**: multi-selección en list/table con `BulkActionBar`, soft-delete con undo toast y atajos de teclado.
- **Espacios**: columnas de tablero personalizadas, notificaciones de vencimiento y mejoras de board/calendar/gantt.
- **Evidencia Volanteo**: etiqueta de cuadrante editable u ocultable en preview, PDF y DOCX (con persistencia de sesión).
- **Reportes de campo**: personalización de tamaño y color del título en preview y PDF.

### Changed
- **Fichas Técnicas**: preview A4 simplificado, lectura de DB sin re-normalizar de más y limpieza de IPC muerto.
- **Espacios**: endurecimiento de sync (carreras create-vs-load), handlers de selección en list/table y flush seguro de delete.
- **Gitignore**: reglas locales de Cursor (`.cursor/rules/`) e ignorado de secrets de Supabase.

### Fixed
- **Espacios**: selección multi-vista cableada; `commitDelete` estable al desmontar; columnas `is_done` custom respetadas en overdue/notificaciones.
- **Evidencia Volanteo / Reportes**: regresiones cubiertas con tests de etiqueta de cuadrante y estilo de título.

### Security
- Detección pre-commit ampliada para tokens `sbp`, service role keys, DB passwords y JWTs anon reales.
- Ignorado de `supabase/.env` y settings locales de Cursor; tests de seguridad alineados.

## [0.10.18] — 2026-07-08

### Added
- **AutoIMG**: Export de renombre NIS (7 dígitos) → SGIO (8 dígitos) con subcarpetas por columna DESTINO de BD_IMG; panel `Renombrar` y APIs `autoimg_rename_export` / `autoimg_rename_dest_config`.
- **AutoIMG**: Aislamiento de datos por usuario Google (scope SHA-256 del email en `userData/autoimg/users/`).
- **AutoIMG**: Preferencias locales por usuario (carpetas de escaneo y carpeta raíz de renombre) sin tokens ni secrets.
- **Tests**: Suites de regresión para NIS, rename, local prefs y user scope.

### Changed
- **AutoIMG**: Parsing NIS más robusto (`6553447_1`, `6553447-3C`, etc.) y slots serializables para IPC.
- **AutoIMG**: Sync engine endurecido (cache de carpetas/logs, RESUMEN desde filas BD_IMG fusionadas, cancelación de operaciones largas).
- **AutoIMG**: UI simplificada — eliminado `SetupWizard`; paneles de auth, dashboard y sync alineados al flujo actual.
- **Gitignore**: Exclusión de prefs/tokens AutoIMG y carpeta `autoimg/` local.

### Fixed
- **Ubicaciones**: Preview en modo manual restaura mapa al montar con lat/lon guardadas; spinner en primer fetch y refresh/retry sin romper export.
- **Ubicaciones**: Retry de guardado consolidado ante WinError 32 (PDF lock en Windows).
- **Espacios / Login**: Ignora fetches obsoletos; restaura tema de la app tras login.
- **AutoIMG**: Invalidación de cache de carpetas/logs tras mutaciones; mirror local de FOLDERS offline.

## [0.10.17] — 2026-07-05

### Added
- **Ubicaciones**: Modo manual con pegado de coordenadas combinadas; 7 proveedores de mapa configurables (OSM, Google, Mapbox, MapTiler, Stadia, Geoapify, Thunderforest).
- **Ubicaciones**: Panel de personalización de diseño en vivo (textos, pin, overlay, layout) con preview WYSIWYG.
- **Ubicaciones**: Persistencia de sesión (carpeta destino, orientación, modo de entrada, datos manuales y estilos) en `localStorage`.
- **Ubicaciones**: Utilidad `coords` y suite de tests `UbicacionesView.config-sync` para reactividad de preview.
- **Petdex**: Mascota (`PetMascot`) y vista de configuración `PetdexView`.
- **AutoIMG**: Soporte de pestañas en hojas Google Sheets y mejoras en sync engine, seguridad y fetch.
- **Tests**: Regresiones de preview manual, parsing de coordenadas combinadas y nombres PDF duplicados.

### Changed
- **Ubicaciones**: Refactor del sidebar y preview con cola de requests, debounce por tipo de cambio y `recomposeOnly` para estilos.
- **AutoIMG**: Barra superior y paneles de arrastre, carpetas y logs alineados al layout unificado.
- **Settings**: Integración de Petdex en el modal de configuración.

### Fixed
- **Ubicaciones**: Columna combinada de coordenadas ya no devuelve `0,0` silencioso; soporta URLs de Google Maps.
- **Ubicaciones**: Error explícito cuando no hay filas válidas; PDFs con `cod_componente` duplicado reciben sufijo (`_2`, `_3`).
- **Ubicaciones**: Preview sincroniza `manualData` en tiempo real; cola de fetch respeta refetch de mapa al cambiar zoom/proveedor.
- **Preview-panel**: Corrección menor en exportación PDF.

## [0.10.16] — 2026-07-03

### Added
- **AutoIMG**: Nueva pestaña con sync Google Sheets/Drive, OAuth PKCE, escaneo multi-carpeta, dashboard, panel de arrastre y tests de regresión en `npm test`.
- **Padrón (folios)**: Controles de folio inicio/fin con interpolación por página e inversión de rango.
- **Conversión**: Mapeo de renombre de columnas Excel en el pipeline de conversión.
- **Templates**: Variantes `certificados-sjl-blanco`, `certificados-sjl-guardamino` y `Certificado-sanidad-lugo`.
- **Tests**: Regresión para backend spawner (restart manual, race auto-restart), CSP de Google Fonts, y renombre de columnas.

### Changed
- **AutoIMG**: Barra superior unificada (h-11) y sidebar de conexión OAuth/Sheets rediseñado.
- **Frontend**: Renombrado `vgen-assets` → `volanteo-assets` y `vpad-assets` → `padron-assets`.
- **Volantes**: Selector de hora con pasos de 1 minuto y rollover correcto al cruzar medianoche.
- **Panel Aviso de Corte**: Routing de plantillas y reenvío de `export_mode`/`template_id` en export PDF/DOCX.
- **Build**: Limpieza de `electron-builder.yml` y scripts de empaquetado.

### Fixed
- **Backend spawner**: Restart manual preempta ciclos de auto-restart; sin backends duplicados en condiciones de carrera.
- **Renamer**: Mejoras en secuencia por fila, mapeo parcial y sanitización de nombres preservados.
- **Historial / jobs**: Correcciones menores en handlers y exportación CSV.

## [0.10.15] — 2026-06-30

### Added
- **Evidencia Volanteo**: Nueva sección y generador para layouts de evidencia de volanteo con grid de imágenes autoajustables, preview interactivo, y descarga de reportes.
- **Panel Aviso de Corte (TemplateSelector)**: Agregado un selector de plantilla compacto en la barra de herramientas para alternar configuraciones de visualización y exportación.
- **Tests**: Pruebas de integración de backend y frontend para layouts de Evidencia Volanteo y renderizado.

### Changed
- **Padrón / Panel Aviso de Corte (Barra de herramientas)**: Relocalización de los selectores de formato de salida y orientación al toolbar para mayor consistencia estética con la altura unificada de 45px.

## [0.10.14] — 2026-06-30

### Fixed
- **Scheduler (cancelación de jobs)**: Un heavy future cancelado antes de arrancar nunca llegaba al `finally` de `_wrapped`, filtrando el slot reservado y el contador `heavy_outstanding` para toda la sesión — cada cancelación de batch encogía `heavy_capacity` permanentemente. Añadido un `done_callback` que libera el slot sólo si `fut.cancelled()` (sin double-release contra el path del `finally`). Nuevo contador `heavy_cancelled` en métricas.
- **Optimizador de imágenes (dedup de nombres)**: El loop que busca un nombre libre en disco estaba sin acotar; una carpeta de destino pre-poblada con miles de archivos colisionantes (`foto.jpg`, `foto-2.jpg`, …) lo hacía iterar indefinidamente. Acotado a `MAX_DEDUP_ATTEMPTS=1000`; al superarse se skipsea el archivo con motivo `no_free_slot` en vez de colgar.
- **Optimizador de imágenes (sanitización de nombres)**: `_safe_name` ahora distingue modo strict (escritura a disco: colapsa separadores `\\/` y caracteres de control, strip de espacios/puntos finales) de lenient (entradas de zip), de modo que `image_optimizer_save_files` no puede escribir fuera de la carpeta destino ni craftear nombres reservados.
- **Ubicaciones (nombre de PDF por fila)**: El nombre se construye vía `sanitizar_nombre`, así un `cod_componente` con caracteres inválidos en Windows (`:*?"<>|`) ya no produce `A:B.pdf` y hace que `PIL.save` levante `OSError` (Errno 22) abortando el batch entero.
- **Ubicaciones (coordenadas no numéricas)**: `_coerce_coord` filtra lat/lon no numéricas antes de paralelizar; un texto como `"abc"` en la columna de coordenadas ya no pasa `pd.isna` para luego crashear `float()` dentro del worker y abortar el batch vía `ex.map`.
- **Ubicaciones (aislamiento de fallos por fila)**: `_render_one` atrapa sus propias excepciones y devuelve `(ok, img)`, así una fila que falla al renderizar (IO, imagen corrupta) no aborta las demás ni el consolidado; el resultado reporta `fallidos`.
- **Frontend (doble `process_start`)**: `useProcessRunner` ahora hace flip optimista de `running` antes del `await` y reset on error. `api.startProcess` puede bloquear ~30s mientras bootea el backend y el botón de start está gateado en `running`, por lo que setearlo después del await permitía que un segundo click encolara un segundo `process_start`.
- **Frontend (delete en inputs)**: `ConversionView` ignora `Backspace`/`Delete` mientras el foco está en un `input`, `textarea`, `select` o `contentEditable`, de modo que editar el patrón de renombrado o los campos de resize ya no borra silenciosamente los archivos seleccionados. `doProcess` además es no-op si ya está corriendo.

### Changed
- **Validadores (path-traversal)**: Extraído `path_param_violations` en `backend/utils/validators.py` como única fuente de verdad para el screening de parámetros path-like. Lo consumen tanto `ipc_protocol.validate_params` (defense-in-depth) como el decorator `handlers.common.@validate_params`, evitando drift entre las dos capas. Modos strict/lenient preservan el comportamiento de cada call site.
- **IPC / Electron (long-running methods)**: La lista `LONG_RUNNING_METHODS` sale de `electron/ipc-methods.js` a `shared/long-running-methods.json` para que el main process y el renderer compartan una única fuente de verdad. El test de allowlist ahora verifica que Electron consuma el JSON verbatim y que toda entrada sea un método permitido.
- **Format Registry**: Eliminados los helpers `get`/`values` sin uso.
- **Image Optimizer**: Inline del alias `cloneBatchSettings` → `cloneSettings`.
- **UI**: Toolbars y headers unificados a 45px de altura across Ubicaciones, Formatos y Volantes.

### Added
- **Formatos (zoom)**: Slider de zoom con rango clampado (25–300%), step fino de 10 y input numérico editable, reemplazando los botones fijos de ±25%.
- **Ubicaciones (panel de resultado)**: El panel muestra las filas omitidas por error (nota amber) y un estado "completado con errores" cuando todas las filas fallan.
- **Fuente Inter**: Preconnect y carga de Inter desde Google Fonts en `index.html`.

## [0.10.13] — 2026-06-26

### Fixed
- **Panel Aviso de Corte (batching)**: Restaurado el agrupamiento original de 4 imágenes por panel. Un cambio en v0.6.10 había roto la lógica de `build_panels()`, creando un panel por cada fila del Excel en lugar de agrupar las imágenes coincidentes en bloques de 4, lo que provocaba que las imágenes solo aparecieran en la primera posición del grid.
- **Panel Aviso de Corte (exportación grande)**: Añadido parámetro `output_path` para que el backend escriba el DOCX/PDF directamente a disco en lugar de devolver ~180MB de base64 por el pipe IPC, lo que causaba el error "Response too large" con 200+ imágenes. El frontend usa `dialogSave` de Electron para que el usuario elija la ruta de guardado.
- **Panel Aviso de Corte (layout PDF/preview)**: Alineadas las dimensiones de las fotos en el PDF y la vista previa con las del DOCX, cambiando de `width:100%; height:100%` a `7.36cm × 9.82cm` fijos.
- **Panel Aviso de Corte (logo PDF)**: Restaurada la altura del `.logo-box` (1.5cm) que fue removida accidentalmente, causando que el div colapsara y el logo no se renderizara. Aumentado el ancho del logo de 5.49cm a 5.76cm en los tres formatos (DOCX, PDF, preview). El límite de 1.5cm es el máximo que WeasyPrint tolera sin generar páginas extra.
- **Panel Aviso de Corte (páginas en blanco)**: Reemplazado `doc.add_page_break()` por la propiedad XML `<w:pageBreakBefore/>` en la primera celda de cada tabla subsiguiente, eliminando los párrafos vacíos que Word renderizaba como páginas en blanco entre paneles. Un export de 54 paneles ahora genera exactamente 54 páginas.
- **Panel Aviso de Corte (preview)**: Reducido el padding superior del preview debajo de la barra de herramientas.

## [0.10.12] — 2026-06-25

### Fixed
- **Backend empaquetado (PyInstaller)**: El backend crasheaba al arranque en los builds empaquetados (v0.10.10–v0.10.11) por `ModuleNotFoundError: No module named 'pandas._config.localization'`. El `backend.spec` listaba manualmente unos pocos hiddenimports de pandas, openpyxl, weasyprint, PIL, lxml, pypdf, jinja2, python-docx y jsonschema, dejando fuera submódulos cargados dinámicamente. Reemplazada la lista manual por `collect_submodules()` para cada paquete pesado, asegurando que TODOS los submódulos se empaqueten.
- **Backend empaquetado**: Removidas las exclusiones de `pandas._testing`, `pandas.io.json`, `pandas.io.parquet` y `pandas.io.sql` del `excludes` del spec, porque pandas las importa internamente y su exclusión causaba `ModuleNotFoundError` al arranque.
- **WeasyPrint en build empaquetado**: `urllib.request.HTTPSHandler` no estaba disponible en el build empaquetado porque `strip=True` corrompía las DLLs nativas de SSL (`_ssl.pyd`, `libssl-3.dll`, `libcrypto-3.dll`). Cambiado `strip=False` y añadidas las DLLs de SSL a `binaries` y `upx_exclude` para que WeasyPrint pueda generar PDFs correctamente.
- **Reportes Generador (plantillas)**: Las plantillas no aparecían en la herramienta porque el backend no arrancaba en el build empaquetado. Con el fix del spec, `templates_list` ahora devuelve las 14 plantillas correctamente.
- **Aviso de Corte (Excel)**: No se podía cargar el Excel porque el backend no respondía. Con el fix del spec, `panel_aviso_corte_parse_excel` funciona correctamente en el build empaquetado.
- **IPC**: Todos los problemas de IPC en el build empaquetado eran consecuencia directa del crash del backend al arranque. Con el fix del spec, el backend arranca, reporta `ready` y todas las llamadas IPC funcionan.

## [0.10.11] — 2026-06-25

### Added
- Reportes de Campo: persistencia de hojas por plantilla en IndexedDB, con tests de serialización de fotos.
- Panel Aviso de Corte: vista previa inmediata por fila de Excel (`excelPreview`) y auto-selección de columnas clave (`ID`) y dirección.

### Fixed
- Ubicaciones: incluir `assets/ubicaciones` en el spec de PyInstaller para que el instalador empaquetado tenga los recursos necesarios.
- Preview Panel: esperar a que el backend esté `ready` antes de llamar a `templates_list`, evitando fallos IPC al arranque.
- Panel Aviso de Corte: corregida vista previa vacía tras importar Excel sin imágenes emparejadas aún.

## [0.10.10] — 2026-06-23

### Added
- Nueva herramienta de Ubicaciones: genera reportes con capturas de Google Maps a partir de un Excel de coordenadas. Backend handler con Playwright persistente, vista frontend con sidebar, dropzone de Excel, selector de formatos y vista previa en tiempo real.
- Pre-warming del navegador Playwright al arranque del backend (`warmup_preview_browser`) para que la primera captura de mapas sea instantánea.
- Lazy-load de thumbnails con `IntersectionObserver` para evitar abrir cientos de `file://` handles simultáneamente en la vista de conversión.

### Changed
- UI de Ubicaciones rediseñada para un look profesional: sidebar en columna flex con header fijo, secciones de config scrollables, botón de generar sticky, labels estilo eyebrow, dropzone con más padding, tarjetas de formato con padding e indicador activo/inactivo consistente.
- Eliminado el debounce de 300ms en la vista previa de Ubicaciones: las peticiones ahora se disparan inmediatamente al cambiar Excel o formato, manteniendo el anti-race-condition con `fetchIdRef`.
- Vista previa unificada WYSIWYG: la exportación reutiliza el navegador Playwright persistente y el cache de mapas con resolución, calibrando el layout a las plantillas de referencia.
- Eliminado el debounce de 300ms en `UbicacionesView.tsx` para preview en tiempo real.
- Optimizaciones de rendimiento (end-to-end audit): cache de `pin.png` a nivel módulo, regex patterns hoisted a nivel módulo en `technical_reports.py`, cache de `load_patterns()` con invalidación, `import psutil` a nivel módulo, `useCallback` estable en `App.tsx`.

### Fixed
- Concorrencia de Playwright: reemplazado `RLock` por un single-thread executor para garantizar afinidad de hilo en la API sync de Playwright, evitando el crash "Sync API inside the asyncio loop" al togglear formatos o navegar filas rápido.
- Acceso serializado a la `Page` de Playwright persistente compartida entre hilos del `ThreadPoolExecutor` (light_workers=4).
- Reducción del wait de captura de mapas de 1200ms a 800ms aprovechando el navegador pre-warmed con Google Maps cacheado.
- Edge Functions: agregado manejo de `OPTIONS` y headers CORS para que `supabase.functions.invoke` funcione desde el frontend en modo dev (antes fallaba con 405 en preflight).
- Panel de admin: reemplazados `supabase.auth.admin.createUser/deleteUser` por Edge Functions (`admin-create-user`, `admin-delete-user`) que validan rol admin con `SUPABASE_SERVICE_ROLE_KEY`, ya que la service_role no está disponible en el frontend.

## [0.10.9] — 2026-06-22

### Fixed
- Supabase en builds de CI: el workflow `release.yml` no pasaba `VITE_SUPABASE_URL` ni `VITE_SUPABASE_ANON_KEY` al paso `Build Frontend`, por lo que Vite embebía `undefined` en el bundle y la app instalada mostraba "Supabase no configurado" al intentar ingresar. Agregadas las variables desde GitHub Secrets al paso de build.
- `supabase.ts`: en builds de producción, si faltan las variables de entorno ahora se lanza un error explícito en lugar de un `console.warn` silencioso, para que el CI falle antes de publicar un instalador roto.

## [0.10.8] — 2026-06-22

### Fixed
- Empaquetado de la app: `electron-builder.yml` no incluía la carpeta `shared/` dentro del `app.asar`, por lo que `electron/dialog-handlers.js` crasheaba al arrancar la app instalada con `Error: Cannot find module '../shared/html-sanitizer'`. Agregada la inclusión `- "shared/**/*"` a la lista de `files`.

## [0.10.7] — 2026-06-22

### Fixed
- Workflow de Release (Windows): agregado step de instalación de Pango/GTK vía MSYS2 antes de `pip install`, para que WeasyPrint encuentre `libgobject-2.0-0` y los tests de `render_pdf` pasen en CI. Antes, los 4 tests de PDF fallaban con `OSError: cannot load library 'libgobject-2.0-0'` y bloqueaban el build del installer.
- Workflows de CI y Release: bump de Node 18 → 20. Vitest 4 depende de `vite@8` → `rolldown`, que importa `styleText` desde `node:util` (solo disponible en Node ≥ 20.12). Node 18 está EOL desde abril 2025.

## [0.10.6] — 2026-06-22

### Fixed
- Agregada dependencia de desarrollo `hypothesis>=6.100.0` para resolver `ModuleNotFoundError` en CI durante la recolección de tests de `tests/panel_aviso_corte`.

## [0.10.5] — 2026-06-22

### Added
- Nuevos componentes de mapeo visual para formatos (MappingColorField, MappingOverlay, MappingPreviewPanel).
- Soporte para exportación de reportes técnicos con grid 3x2 dinámico y stretch de imágenes.
- Nuevos tests para mapeo de formatos, optimizador de imágenes y manejo de diálogos de Electron.
- Assets de registro: imagen y video de sign-up.

### Changed
- Mejoras en el backend de reportes, formatos, sellador y optimizador de imágenes.
- Refactor del IPC de Electron y manejo de ventanas.
- Actualización de dependencias en frontend y .gitignore para archivos temporales/caché.
- Limpieza de credenciales de Supabase en `.env.example` mediante reescritura de historial.
- Actualización de versiones a `0.10.5` en todos los manifiestos del proyecto.

### Fixed
- Correcciones en la UI de formatos, sidebar y optimizador.
- Ajustes en locales y sanitización de HTML compartido.

## [1.10.5] — 2025-06-01

### Fixed
- Correcciones menores en el backend de procesamiento de imágenes.

### Changed
- Actualización de dependencias.

## [1.10.4] — 2025-05-15

### Fixed
- Corrección en el manejador de formatos para exports Excel.

## [1.10.3] — 2025-05-01

### Added
- Nueva funcionalidad de informes técnicos con exportación a PDF/Excel.

### Fixed
- Corrección en la asignación de renombrado por lotes.

## [1.10.2] — 2025-04-15

### Changed
- Mejoras en la UI de conversión con soporte para arrastrar y soltar.

## [1.10.1] — 2025-04-01

### Fixed
- Correcciones en el spawned de backend y manejo de errores de IPC.

## [1.10.0] — 2025-03-15

### Added
- Soporte para múltiples formatos de salida (PNG, JPG, WEBP, BMP, TIFF).
- Renombrado por lotes con patrones personalizados.
- Tema oscuro completo.
- Auto-actualizador integrado (electron-updater).

### Changed
- Migración a React 18 + TypeScript + Vite + TailwindCSS.
- Arquitectura IPC renovada con backend Python separado.

<!--
Template para nuevas entradas:

## [X.Y.Z] — YYYY-MM-DD

### Added
- Nueva funcionalidad.

### Changed
- Cambios en funcionalidad existente.

### Deprecated
- Funcionalidad que será eliminada en futuras versiones.

### Removed
- Funcionalidad eliminada en esta versión.

### Fixed
- Corrección de errores.

### Security
- Parches de seguridad.
-->
