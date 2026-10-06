# Estándares de implementación

Referencia por área para las tareas enrutadas desde [AGENTS.md](AGENTS.md). Lee las secciones aplicables; la política de cambios mínimos de ese archivo rige también aquí.

## Backend

- Python nuevo usa indentación de 4 espacios, type hints, `snake_case` y clases `PascalCase`. Consulta Ruff y mypy en `pyproject.toml`; respeta el largo de línea configurado aunque `E501` esté ignorado.
- stdout de `backend/main.py` transporta JSON-RPC delimitado por líneas. Envía todo logging a stderr mediante las utilidades existentes.
- Conserva la carga lazy de `HandlerRegistry` en `backend/handlers/__init__.py`: los handlers core se calientan antes de `ready`, Canvas y conversión después, y el resto bajo demanda.
- `backend/core/scheduler.py` gestiona los lanes `light` y `heavy`, workers, backpressure y presión de memoria. El lane `sync` se resuelve en línea en `backend/main.py`.
- `process_start` inicia un trabajo en segundo plano mediante `JobManager`; conserva el lector IPC sin bloquear.

## IPC y contratos

- La ruta del renderer es `frontend/src/api.ts` → `window.electronAPI`/`electron/preload.js` → `electron/ipc-router.js` → handler nativo o Python. React no importa Electron, Node ni módulos del proceso principal.
- `shared/ipc-method-catalog.json` define handler, lane, timeout, idempotencia y política de archivos por método. Usa sus proyecciones `shared/ipc-method-catalog.js` y `backend/core/ipc_catalog.py`; no reconstruyas listas paralelas. Lane y timeout son independientes.
- Para un método nuevo o modificado, declara el cambio en el catálogo y revisa `frontend/src/api.ts`, `electron/preload.js` y el handler correspondiente. Actualiza las pruebas de paridad `tests/test-electron-ipc-allowlist.js` y `tests/test_ipc_catalog.py`.
- Al cambiar cualquier contrato compartido, actualiza todos sus consumidores y pruebas sin reorganizarlos ni tocar otros contratos.
- Solo reintenta lecturas declaradas idempotentes. Una escritura necesita demostrar idempotencia antes de poder reintentarse.
- Conserva `contextIsolation`, `nodeIntegration: false`, sandbox, CSP, validación del sender, allowlist de métodos y restricciones de navegación.
- Para arranque o empaquetado, consulta `electron/backend-spawner.js`: conserva el handshake `ready`, health checks, recuperación acotada y resolución del ejecutable de desarrollo/producción.

## Frontend

- TypeScript/React nuevo usa 2 espacios, componentes `PascalCase`, hooks `use*` y Tailwind/tokens existentes. Usa CSS con scope cuando haga falta una skin local; evita CSS global ad hoc.
- Controles y superficies flotantes consumen `frontend/src/components/ui/` y `frontend/src/hooks/useAnchoredPopover.ts`. Extiende `Button`, `DatePicker`, `ThemedSelect`, `Dialog` o `HoverTooltip` antes de duplicarlos. La superficie modal es `ui/Dialog.tsx`; no hay una primitiva `Modal`. Las skins locales siguen el patrón de overrides `.vpad-*`/`.vgen-*`.
- Navegación, nombres de tabs y secciones de ajustes salen de `frontend/src/navigation.ts`; las vistas se cargan de forma diferida en `frontend/src/App.tsx`. Conserva lazy loading, Error Boundaries y providers de toast/dialog.
- `AuthGate` es obligatorio solo para `espacios`. Las herramientas locales funcionan sin sesión ni dependencia de Supabase.
- Toda UI del producto está en español, sin selector de idioma ni soporte de inglés para el usuario. `frontend/src/i18n.ts` y `frontend/src/locales/es.json` cubren las áreas ya adoptadas. Añade claves solo con un consumidor `t()` en el mismo cambio. El catálogo debe reflejar exactamente las claves utilizadas por la UI; `optimizer.presets.*` se resuelve dinámicamente por id.
- HTML para preview/PDF pasa por `shared/html-sanitizer.js` y cumple `shared/html-sanitizer-spec.json`. Los recursos externos deben respetar la CSP.
- Para montaje/desmontaje de Canvas o cierre de la app, aplica también [Canvas](#canvas).
- Para dependencias, chunks o imports diferidos del shell, aplica los budgets de [Entorno y calidad](#entorno-y-calidad).

## Persistencia y seguridad

- Resuelve rutas mediante `backend/utils/paths.py`. No hardcodees rutas ni asumas que `data/` es siempre el origen persistente: desarrollo y builds congeladas pueden usar stores distintos.
- El catálogo SQLite vive en datos de usuario; conserva conexiones/pools y WAL gestionados por `backend/core/repository.py`.
- Plantillas bundled son recursos de aplicación. Resuelve las del usuario desde su directorio de datos y conserva las bundled sin sobrescribirlas durante la ejecución.
- Lecturas desde el renderer usan tokens de capacidad `file_token`, diálogos nativos aprobados o staging binario. Las escrituras pasan por roots/tokens de escritura. Conserva el rechazo de traversal, symlinks y rutas no permitidas; el renderer no envía rutas absolutas arbitrarias para leer.
- Conserva el flujo de `electron/dialog-handlers.js`, `electron/file-capabilities.js`, `electron/ipc-file-policy.js` y `electron/path-allowlist.js`.
- Credenciales, secretos y service-role keys permanecen fuera de la UI. `VITE_*` es configuración pública del cliente.

## Canvas

- El JSON local es la fuente inmediata de verdad; Supabase es un espejo best-effort. Los errores cloud no inutilizan el modo local.
- Conserva el store atómico, locks, recovery e historial en `backend/core/canvas/`. Resuelve documentos, historial, assets y spill/recovery mediante `backend/utils/paths.py`; la migración de documentos antiguos de `data/canvas/documents` sigue `backend/core/canvas/store.py`.
- El contrato es `shared/canvas-schema.json`. Actualiza tipos espejo TypeScript/Python y normalizadores al cambiarlo. Conserva actualización de documentos antiguos, reestampado de versión y límites de `pageIndex` en ambos extremos.
- Assets binarios usan métodos `canvas_asset_put`, `canvas_asset_get` y `canvas_asset_info` de Electron y referencias `canvas-asset:`. Solo embebe blobs grandes en JSON si lo exige el contrato. El GC es el timer interno `runCanvasAssetGc` en `electron/main.js`, no un método IPC.
- `useCanvasHistory` distingue `setDocument` para edición discreta, `updateSilent` para preview vivo y `commitFromBaseline` para una entrada por gesto. `gestureRaf` y `pointerGestureSession` en `frontend/src/components/canvas/ops/` coalescen eventos y abortan en undo, cancel o unmount.
- Mantén independientes los límites RAM de entradas y bytes del historial, además de su persistencia por documento. Consulta sus valores en la implementación.
- Conserva autosave por cambios y en cambio de documento, duplicado, borrado, pérdida de foco, unmount y cierre. Ctrl+S no es el único disparador.
- Canvas puede permanecer montado temporalmente al cambiar de tab para conservar estado y participa en el flush de cierre. Modificar ese ciclo de vida requiere actualizar sus pruebas.
- RGB PDF usa `frontend/src/components/canvas/runtime/renderHtml.ts` y `html_to_pdf`; CMYK usa `canvas_export_cmyk_pdf` y el renderer Python. Prefiere RGB cuando importe la fidelidad de tablas, grids, checkbox, firmas o formas complejas; CMYK tiene fallbacks a bounding box.
- `frontend/src/components/canvas/sync/canvasCloudSync.ts` aplica LWW por `updatedAt`, pushes agrupados por documento, RPC con fallback compatible y timeout. Conserva Realtime privado para guardados, presencia y pulls dirigidos, con debounce/reintentos.
- No hay merge operacional por capa. Un editor local dirty presenta conflicto para conservar local o usar remoto; los snapshots concurrentes terminan en LWW.
- El primer sync no borra ni sobrescribe silenciosamente documentos locales. Un remoto más nuevo reemplaza solo un documento limpio y reinicia las pilas RAM de undo/redo.
- Para chunks de Canvas, aplica los budgets de [Entorno y calidad](#entorno-y-calidad).

## Supabase

- `supabase/migrations/` es la fuente de verdad del esquema. Conserva RLS, least privilege y la separación de funciones privadas; los problemas de permisos no se resuelven exponiendo tablas o funciones privilegiadas al cliente.
- `supabase/functions/admin-create-user` y `admin-delete-user` requieren el modelo administrativo de credenciales existente, sin secretos en la UI.
- Para aplicar migraciones remotas, usa el complemento Supabase autenticado en Codex, verifica el project ref y compara el historial remoto antes de aplicar las pendientes locales. Un despliegue remoto no sustituye las pruebas locales.
- Configura `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` fuera del repositorio cuando la tarea las necesite. Para cambios de conectividad/CSP, consulta `electron/main.js`: `ANTARES_SUPABASE_URL`, o `VITE_SUPABASE_URL` en el entorno principal, puede fijar `connect-src` al proyecto en lugar del wildcard.
- Para Auth o conectividad, aplica las restricciones de `AuthGate` y herramientas locales de [Frontend](#frontend); para sync de Canvas aplica también [Canvas](#canvas).

## Entorno y calidad

- Versiones, dependencias y comandos salen de `package.json`, `frontend/package.json`, `pyproject.toml`, sus lockfiles y `.node-version`. Comprueba esos archivos en lugar de inferir versiones del README.
- Para preparar el entorno usa `npm ci`, `npm ci --prefix frontend` y `uv sync --locked --extra dev`. El empaquetado soportado se verifica en Windows.
- Consulta los scripts antes de elegir comandos de build, auditoría o calidad. `scripts/run-test-suites.js` define las suites de `npm test`; usa `-m slow` solo para pruebas explícitamente lentas.
- `scripts/check_any_guard.py` requiere excepciones explícitas y justificadas. Para límites de calidad y bundles consulta `.quality-baseline.json`, `shared/budgets.json`, `scripts/quality-ratchet.js` y `scripts/check-budgets.js`; los aumentos de techo siguen la política de AGENTS.
- Cumple los budgets de Canvas y shell en `shared/budgets.json` y `scripts/check-budgets.js`, incluidos límites de incremento, vendors iniciales y modulepreload.

## Git, PR y releases

- Publica cambios con `npm run push:ship`; inspecciona con `npm run push:dry-run`. Proporciona el mensaje requerido y usa los flags del script, conservando sus validaciones. `push:merge` añade espera de checks y solicitud de merge.
- `push:ship` y `pr-fix:ship` commitean el índice si tiene archivos; con índice vacío recurren a `git add -A`. Stagea selectivamente antes de invocarlos. Con índice vacío solo pueden ejecutarse si no hay cambios ajenos. `pr-fix:ship` además aborta ante cambios previos a sus heurísticas.
- Para un PR existente usa `npm run pr-fix` como inspección; `pr-fix:ship` aplica fixes acotados y `pr-fix:merge` solicita merge cuando está aprobado, sin conflictos y con checks verdes. Consulta flags y límites en `scripts/pr-fix-loop.js`.
- El cuerpo del PR incluye propósito, issue/PR relacionado si existe, riesgo, evidencia de tests y screenshots para UI. Sigue `.github/pull_request_template.md`; consulta `scripts/review-policy-check.js` para la política ejecutable.
- Documenta merge, sync con `origin/main`, conflictos y restauraciones aprobadas en el PR. Son operaciones de rama, no parte del diff de tarea; mantén staging selectivo de los commits propios.
- Releases requieren branch `main`, árbol limpio, HEAD exactamente en `origin/main`, changelog con versión/fecha/sección y tag no duplicado. No borres cambios ajenos para cumplirlo.
- Usa `release:dry-run` para validar, `release:ship` para crear/empujar el tag anotado y `release:full` si también necesitas build local. `scripts/release-loop.js` realiza las validaciones y GitHub Actions construye/publica la release. Revisa `CHANGELOG.md` antes de incrementar versión.
