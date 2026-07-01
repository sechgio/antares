# Changelog

Todas las versiones notables de ANTARES se documentan aquí.

Formato basado en [Keep a Changelog](https://keepachangelog.com/),
y este proyecto sigue [Semantic Versioning](https://semver.org/).

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
